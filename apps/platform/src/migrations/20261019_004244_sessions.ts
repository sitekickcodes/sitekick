import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_sessions_status" AS ENUM('starting', 'branching', 'booting', 'installing', 'migrating', 'starting_server', 'ready', 'failed', 'stopped');
  CREATE TABLE "sites_sandbox_env" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"value" varchar
  );
  
  CREATE TABLE "sessions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" integer NOT NULL,
  	"user_id" integer NOT NULL,
  	"status" "enum_sessions_status" DEFAULT 'starting' NOT NULL,
  	"preview_url" varchar,
  	"git_branch" varchar,
  	"sandbox_name" varchar,
  	"neon_project_id" varchar,
  	"neon_branch_id" varchar,
  	"error" varchar,
  	"log" varchar,
  	"phase_started_at" timestamp(3) with time zone,
  	"sandbox_expires_at" timestamp(3) with time zone,
  	"last_active_at" timestamp(3) with time zone,
  	"ready_at" timestamp(3) with time zone,
  	"ended_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "sites" ADD COLUMN "sandbox_neon_project_id" varchar;
  ALTER TABLE "sites" ADD COLUMN "sandbox_neon_parent_branch" varchar DEFAULT 'staging';
  ALTER TABLE "sites" ADD COLUMN "sandbox_neon_database" varchar DEFAULT 'neondb';
  ALTER TABLE "sites" ADD COLUMN "sandbox_neon_role" varchar DEFAULT 'neondb_owner';
  ALTER TABLE "sites" ADD COLUMN "sandbox_install_command" varchar;
  ALTER TABLE "sites" ADD COLUMN "sandbox_migrate_command" varchar;
  ALTER TABLE "sites" ADD COLUMN "sandbox_dev_command" varchar DEFAULT 'npx next dev --hostname 0.0.0.0 --port 3000';
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "sessions_id" integer;
  ALTER TABLE "sites_sandbox_env" ADD CONSTRAINT "sites_sandbox_env_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sessions" ADD CONSTRAINT "sessions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "sites_sandbox_env_order_idx" ON "sites_sandbox_env" USING btree ("_order");
  CREATE INDEX "sites_sandbox_env_parent_id_idx" ON "sites_sandbox_env" USING btree ("_parent_id");
  CREATE INDEX "sessions_site_idx" ON "sessions" USING btree ("site_id");
  CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");
  CREATE INDEX "sessions_status_idx" ON "sessions" USING btree ("status");
  CREATE INDEX "sessions_updated_at_idx" ON "sessions" USING btree ("updated_at");
  CREATE INDEX "sessions_created_at_idx" ON "sessions" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_sessions_fk" FOREIGN KEY ("sessions_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_sessions_id_idx" ON "payload_locked_documents_rels" USING btree ("sessions_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sites_sandbox_env" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sessions" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "sites_sandbox_env" CASCADE;
  DROP TABLE "sessions" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_sessions_fk";
  
  DROP INDEX "payload_locked_documents_rels_sessions_id_idx";
  ALTER TABLE "sites" DROP COLUMN "sandbox_neon_project_id";
  ALTER TABLE "sites" DROP COLUMN "sandbox_neon_parent_branch";
  ALTER TABLE "sites" DROP COLUMN "sandbox_neon_database";
  ALTER TABLE "sites" DROP COLUMN "sandbox_neon_role";
  ALTER TABLE "sites" DROP COLUMN "sandbox_install_command";
  ALTER TABLE "sites" DROP COLUMN "sandbox_migrate_command";
  ALTER TABLE "sites" DROP COLUMN "sandbox_dev_command";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "sessions_id";
  DROP TYPE "public"."enum_sessions_status";`)
}
