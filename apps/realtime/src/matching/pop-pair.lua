--[[
pop_pair.lua — atomic matchmaking script for freecall realtime service.

KEYS (variable length, n = number of candidate queue zsets):
  KEYS[1..n]    candidate queue zsets (preference order: exact, lang-widened, region-widened…)
  KEYS[n+1]     my exclusion zset:  mm:{region}:ex:{sid}
  KEYS[n+2]     my claim key:       mm:{region}:claim:{sid}

ARGV:
  ARGV[1]   my sid
  ARGV[2]   now_ms (integer string)
  ARGV[3]   my entry json  {"c":"DE","l":"en","b":2,"t":"t1","g":"m","sg":true,"p":0}
  ARGV[4]   max_probes (integer, default 50)
  ARGV[5]   cooldown_sec (integer, recent-partner cooldown)
  ARGV[6]   my trust band numeric: low=0, normal=1, high=2
  ARGV[7]   n (number of queue keys)
  ARGV[8]   my strict_gender flag: "1" = strict, "0" = flexible

Returns one of:
  {"status":"wait","probes":N}
  {"status":"already_claimed"}
  {"status":"matched","a":sid_a,"b":sid_b,"a_entry":json,"b_entry":json,"queue_key":key,"matched_at":ms}
--]]

local my_sid         = ARGV[1]
local now_ms         = tonumber(ARGV[2])
local my_entry_raw   = ARGV[3]
local max_probes     = tonumber(ARGV[4]) or 50
local cooldown_sec   = tonumber(ARGV[5]) or 1800
local my_band        = tonumber(ARGV[6]) or 1
local n_queues       = tonumber(ARGV[7]) or 1
local my_strict_gender = (ARGV[8] == "1")

local ex_key    = KEYS[n_queues + 1]
local claim_key = KEYS[n_queues + 2]

-- 1. Prune expired cooldowns from my exclusion set (keep blocks which have far-future score).
redis.call('ZREMRANGEBYSCORE', ex_key, '-inf', tostring(now_ms))

-- 2. Guard: if claim key already exists I'm already being matched on another pod.
if redis.call('EXISTS', claim_key) == 1 then
  return '{"status":"already_claimed"}'
end

-- Parse my entry to extract preferences.
-- Entry format: {"c":"DE","l":"en","b":2,"t":"t1","g":"m","sg":true,"p":0}
-- We do minimal parsing using pattern matching to avoid cjson dependency issues in older Redis.
local function extract_str(json, key)
  local v = json:match('"' .. key .. '"%s*:%s*"([^"]*)"')
  return v
end
local function extract_num(json, key)
  local v = json:match('"' .. key .. '"%s*:%s*([%d%.%-]+)')
  return tonumber(v)
end
local function extract_bool(json, key)
  local v = json:match('"' .. key .. '"%s*:%s*(true|false)')
  return v == "true"
end

local my_country       = extract_str(my_entry_raw, 'c') or 'any'
local my_gender        = extract_str(my_entry_raw, 'g')   -- nil if unset
local my_band_n        = extract_num(my_entry_raw, 'b') or my_band

-- Stale threshold: entries older than 20s with no presence refresh are skipped and pruned.
local stale_threshold_ms = 20000

local probes = 0
local best_sid    = nil
local best_entry  = nil
local best_queue  = nil
local best_delta  = 999

for qi = 1, n_queues do
  local q_key = KEYS[qi]
  -- Read up to max_probes candidates ordered by score (lowest = oldest / highest priority).
  local candidates = redis.call('ZRANGE', q_key, 0, max_probes - 1, 'WITHSCORES')

  local i = 1
  while i <= #candidates do
    local cand_sid   = candidates[i]
    local cand_score = tonumber(candidates[i + 1])
    i = i + 2
    probes = probes + 1

    -- Skip self.
    if cand_sid == my_sid then goto continue end

    -- Skip stale entries (score = enqueued_at_ms, adjusted for priority).
    -- Stale = enqueued more than 20s ago and the score reflects the original enqueue time.
    -- We compare score magnitude: negative scores are priority-boosted, still valid.
    local age_ms = now_ms - math.abs(cand_score)
    if age_ms > stale_threshold_ms then
      -- Prune the stale entry and its metadata.
      redis.call('ZREM', q_key, cand_sid)
      goto continue
    end

    -- Skip if I am in candidate's exclusion set.
    local cand_ex_key = ex_key:gsub(':ex:' .. my_sid, ':ex:' .. cand_sid)
    -- More robustly: derive cand exclusion key from the pattern.
    -- ex_key pattern: mm:{region}:ex:{my_sid}
    -- We need: mm:{region}:ex:{cand_sid}
    -- Extract prefix before :ex:.
    local prefix = ex_key:match('^(.+):ex:')
    if prefix then
      cand_ex_key = prefix .. ':ex:' .. cand_sid
    end

    local my_score_in_cand_ex = redis.call('ZSCORE', cand_ex_key, my_sid)
    if my_score_in_cand_ex then
      local expiry = tonumber(my_score_in_cand_ex)
      -- Block entries have score 2^41 (~month); cooldown entries have score now+cooldown_ms.
      if expiry > now_ms then
        goto continue
      end
    end

    -- Skip if candidate is in my exclusion set.
    local my_score_of_cand = redis.call('ZSCORE', ex_key, cand_sid)
    if my_score_of_cand then
      local expiry = tonumber(my_score_of_cand)
      if expiry > now_ms then
        goto continue
      end
    end

    -- Read candidate metadata from the metadata hash (same queue prefix + ':m').
    local meta_key = q_key:match('^(.+):q$')
    if not meta_key then goto continue end
    meta_key = meta_key .. ':m'
    local cand_entry_raw = redis.call('HGET', meta_key, cand_sid)
    if not cand_entry_raw then goto continue end

    -- Parse candidate entry.
    local cand_country = extract_str(cand_entry_raw, 'c') or 'any'
    local cand_band    = extract_num(cand_entry_raw, 'b') or 1
    local cand_gender  = extract_str(cand_entry_raw, 'g')  -- nil if unset
    local cand_strict  = extract_bool(cand_entry_raw, 'sg')

    -- Country preference: mutual match required.
    if my_country ~= 'any' and cand_country ~= 'any' and my_country ~= cand_country then
      goto continue
    end

    -- Trust band gap: never pair if |my_band - cand_band| > 1.
    local band_delta = math.abs(my_band_n - cand_band)
    if band_delta > 1 then goto continue end

    -- Gender preference: skip if either side is strict AND genders are set but differ.
    -- Rules:
    --   strict=true  → I only match someone whose gender equals my preference (if I have one)
    --                   AND the candidate must be ok with my gender (their strict or flexible)
    --   strict=false → I accept anyone; only the other side can veto
    do
      local gender_ok = true
      -- My strict check: I require the candidate's gender matches my own gender pref.
      -- (Convention: own_gender is the gender I *am*, partner sees it to decide.)
      -- If I set strict_gender I want a partner of a specific gender.
      -- We encode: g = my own gender. The partner sees it and applies *their* strict rule.
      if my_strict_gender and my_gender ~= nil and cand_gender ~= nil then
        -- A strict user wants the opposite gender (m↔f). If same gender, skip.
        -- Also allow "nb" (non-binary) to match anyone.
        if my_gender ~= 'nb' and cand_gender ~= 'nb' and my_gender == cand_gender then
          gender_ok = false
        end
      end
      -- Candidate strict check: candidate's strict_gender flag (sg) means THEY are strict.
      if cand_strict and cand_gender ~= nil and my_gender ~= nil then
        if cand_gender ~= 'nb' and my_gender ~= 'nb' and cand_gender == my_gender then
          gender_ok = false
        end
      end
      if not gender_ok then goto continue end
    end

    -- Keep best candidate (smallest band_delta; ties broken by longest wait).
    if band_delta < best_delta then
      best_delta = band_delta
      best_sid   = cand_sid
      best_entry = cand_entry_raw
      best_queue = q_key
    end

    ::continue::
  end

  -- Stop searching if we found a good match.
  if best_sid ~= nil then break end
end

-- No match found.
if best_sid == nil then
  return '{"status":"wait","probes":' .. probes .. '}'
end

-- Found a match. Now atomically pair them.
-- Determine metadata key for the winning queue.
local meta_key = best_queue:match('^(.+):q$') .. ':m'

-- Remove both from their queue and metadata hash.
redis.call('ZREM', best_queue, my_sid)
redis.call('ZREM', best_queue, best_sid)
redis.call('HDEL', meta_key, my_sid)
redis.call('HDEL', meta_key, best_sid)

-- Write recent-partner cooldown entries in both exclusion sets.
-- Score = now_ms + cooldown_sec * 1000 (millisecond expiry)
local cooldown_expiry = now_ms + cooldown_sec * 1000
local prefix = ex_key:match('^(.+):ex:')
local cand_ex_key_final = prefix .. ':ex:' .. best_sid

redis.call('ZADD', ex_key, tostring(cooldown_expiry), best_sid)
redis.call('ZADD', cand_ex_key_final, tostring(cooldown_expiry), my_sid)

-- Set claim keys NX EX 10 on both sides to prevent double-pairing.
local my_claim_key   = claim_key
local cand_claim_key = claim_key:gsub(':claim:' .. my_sid, ':claim:' .. best_sid)
if prefix then
  cand_claim_key = prefix .. ':claim:' .. best_sid
end

redis.call('SET', my_claim_key,   '1', 'NX', 'EX', '10')
redis.call('SET', cand_claim_key, '1', 'NX', 'EX', '10')

-- Return match result as JSON.
-- Escape any quotes in entries to avoid breaking JSON (entries are already valid JSON objects).
local result = '{"status":"matched"'
  .. ',"a":"'  .. my_sid    .. '"'
  .. ',"b":"'  .. best_sid  .. '"'
  .. ',"a_entry":' .. my_entry_raw
  .. ',"b_entry":' .. best_entry
  .. ',"queue_key":"' .. best_queue .. '"'
  .. ',"matched_at":' .. tostring(now_ms)
  .. '}'

return result
