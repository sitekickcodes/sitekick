import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_sessions_agent_status" AS ENUM('idle', 'working');
  CREATE TYPE "public"."enum_messages_role" AS ENUM('user', 'assistant', 'tool', 'notice');
  CREATE TABLE "messages" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"session_id" integer NOT NULL,
  	"role" "enum_messages_role" NOT NULL,
  	"text" varchar NOT NULL,
  	"turn" numeric NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "sessions" ADD COLUMN "agent_status" "enum_sessions_agent_status" DEFAULT 'idle';
  ALTER TABLE "sessions" ADD COLUMN "agent_session_id" varchar;
  ALTER TABLE "sessions" ADD COLUMN "turns" numeric DEFAULT 0;
  ALTER TABLE "sessions" ADD COLUMN "agent_cost_usd" numeric DEFAULT 0;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "messages_id" integer;
  ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "messages_session_idx" ON "messages" USING btree ("session_id");
  CREATE INDEX "messages_updated_at_idx" ON "messages" USING btree ("updated_at");
  CREATE INDEX "messages_created_at_idx" ON "messages" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_messages_fk" FOREIGN KEY ("messages_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_messages_id_idx" ON "payload_locked_documents_rels" USING btree ("messages_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "messages" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "messages" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_messages_fk";
  
  DROP INDEX "payload_locked_documents_rels_messages_id_idx";
  ALTER TABLE "sessions" DROP COLUMN "agent_status";
  ALTER TABLE "sessions" DROP COLUMN "agent_session_id";
  ALTER TABLE "sessions" DROP COLUMN "turns";
  ALTER TABLE "sessions" DROP COLUMN "agent_cost_usd";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "messages_id";
  DROP TYPE "public"."enum_sessions_agent_status";
  DROP TYPE "public"."enum_messages_role";`)
}
