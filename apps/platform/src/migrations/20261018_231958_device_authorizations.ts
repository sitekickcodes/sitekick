import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_device_authorizations_status" AS ENUM('pending', 'approved', 'denied', 'consumed');
  CREATE TABLE "device_authorizations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"device_code_hash" varchar NOT NULL,
  	"user_code" varchar NOT NULL,
  	"device_name" varchar,
  	"status" "enum_device_authorizations_status" DEFAULT 'pending' NOT NULL,
  	"user_id" integer,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"last_polled_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "device_authorizations_id" integer;
  ALTER TABLE "device_authorizations" ADD CONSTRAINT "device_authorizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "device_authorizations_device_code_hash_idx" ON "device_authorizations" USING btree ("device_code_hash");
  CREATE UNIQUE INDEX "device_authorizations_user_code_idx" ON "device_authorizations" USING btree ("user_code");
  CREATE INDEX "device_authorizations_user_idx" ON "device_authorizations" USING btree ("user_id");
  CREATE INDEX "device_authorizations_updated_at_idx" ON "device_authorizations" USING btree ("updated_at");
  CREATE INDEX "device_authorizations_created_at_idx" ON "device_authorizations" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_device_authorizations_fk" FOREIGN KEY ("device_authorizations_id") REFERENCES "public"."device_authorizations"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_device_authorizations_id_idx" ON "payload_locked_documents_rels" USING btree ("device_authorizations_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "device_authorizations" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "device_authorizations" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_device_authorizations_fk";
  
  DROP INDEX "payload_locked_documents_rels_device_authorizations_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "device_authorizations_id";
  DROP TYPE "public"."enum_device_authorizations_status";`)
}
