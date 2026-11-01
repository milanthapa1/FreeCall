import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { friendRequestStatus } from "./enums";
import { users } from "./identity";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/**
 * Undirected friendship, stored once with a canonical low/high pair so "are these two
 * friends?" is a single primary-key lookup. `uuid` comparison is bytewise in Postgres.
 */
export const friendships = pgTable(
  "friendships",
  {
    userLow: uuid("user_low")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    userHigh: uuid("user_high")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.userLow, table.userHigh] }),
    check("friendships_canonical_order", sql`${table.userLow} < ${table.userHigh}`),
    index("friendships_high_idx").on(table.userHigh),
  ],
);

export const friendRequests = pgTable(
  "friend_requests",
  {
    id: uuid("id").primaryKey(),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: friendRequestStatus("status").notNull().default("pending"),
    message: text("message"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    check("friend_requests_not_self", sql`${table.fromUserId} <> ${table.toUserId}`),
    check(
      "friend_requests_message_length",
      sql`${table.message} is null or char_length(${table.message}) <= 500`,
    ),
    /**
     * One pending request per unordered pair, in either direction. Without the
     * least/greatest expression A→B and B→A could both be pending.
     */
    uniqueIndex("friend_requests_pending_pair_unique")
      .on(
        sql`least(${table.fromUserId}, ${table.toUserId})`,
        sql`greatest(${table.fromUserId}, ${table.toUserId})`,
      )
      .where(sql`${table.status} = 'pending'`),
    index("friend_requests_inbox_idx").on(table.toUserId, table.status, table.createdAt.desc()),
  ],
);

/**
 * Direct messages only. In-call chat is held in memory and captured into evidence on a
 * report — it is never persisted here (data minimization, docs/privacy.md).
 */
export const messagesDm = pgTable(
  "messages_dm",
  {
    id: uuid("id").primaryKey(),
    threadKey: text("thread_key").notNull(),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removalReason: text("removal_reason"),
    createdAt,
  },
  (table) => [
    check("messages_dm_not_self", sql`${table.senderId} <> ${table.recipientId}`),
    check("messages_dm_body_length", sql`char_length(${table.body}) between 1 and 2000`),
    check(
      "messages_dm_removal_consistent",
      sql`(${table.removedAt} is null) = (${table.removalReason} is null)`,
    ),
    index("messages_dm_thread_idx").on(table.threadKey, table.createdAt.desc()),
    index("messages_dm_unread_idx")
      .on(table.recipientId, table.readAt)
      .where(sql`${table.readAt} is null`),
  ],
);
