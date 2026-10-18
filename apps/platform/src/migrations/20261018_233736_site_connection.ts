import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_sites_connection_status" AS ENUM('ok', 'problem', 'not_configured', 'unchecked');
  ALTER TABLE "sites" ALTER COLUMN "default_branch" DROP DEFAULT;
  ALTER TABLE "sites" ADD COLUMN "connection_status" "enum_sites_connection_status" DEFAULT 'unchecked';
  ALTER TABLE "sites" ADD COLUMN "connection_message" varchar;
  ALTER TABLE "sites" ADD COLUMN "connection_checked_at" timestamp(3) with time zone;
  ALTER TABLE "sites" ADD COLUMN "connection_github_installation_id" numeric;
  ALTER TABLE "sites" ADD COLUMN "connection_github_repo_id" numeric;
  ALTER TABLE "sites" ADD COLUMN "connection_github_can_push" boolean;
  ALTER TABLE "sites" ADD COLUMN "connection_vercel_project_id" varchar;
  ALTER TABLE "sites" ADD COLUMN "connection_vercel_project_name" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sites" ALTER COLUMN "default_branch" SET DEFAULT 'main';
  ALTER TABLE "sites" DROP COLUMN "connection_status";
  ALTER TABLE "sites" DROP COLUMN "connection_message";
  ALTER TABLE "sites" DROP COLUMN "connection_checked_at";
  ALTER TABLE "sites" DROP COLUMN "connection_github_installation_id";
  ALTER TABLE "sites" DROP COLUMN "connection_github_repo_id";
  ALTER TABLE "sites" DROP COLUMN "connection_github_can_push";
  ALTER TABLE "sites" DROP COLUMN "connection_vercel_project_id";
  ALTER TABLE "sites" DROP COLUMN "connection_vercel_project_name";
  DROP TYPE "public"."enum_sites_connection_status";`)
}
