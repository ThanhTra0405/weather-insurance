using System;
using System.Numerics;
using System.Text.Json;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace backend.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "audit_logs",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    actor_type = table.Column<string>(type: "text", nullable: false),
                    actor_ref = table.Column<string>(type: "text", nullable: true),
                    action = table.Column<string>(type: "text", nullable: false),
                    target = table.Column<string>(type: "text", nullable: true),
                    detail = table.Column<JsonDocument>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_audit_logs", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "auth_nonces",
                columns: table => new
                {
                    wallet_address = table.Column<string>(type: "text", nullable: false),
                    nonce = table.Column<string>(type: "text", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_auth_nonces", x => x.wallet_address);
                });

            migrationBuilder.CreateTable(
                name: "chain_events",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    block_number = table.Column<long>(type: "bigint", nullable: false),
                    tx_hash = table.Column<string>(type: "text", nullable: false),
                    log_index = table.Column<int>(type: "integer", nullable: false),
                    contract = table.Column<string>(type: "text", nullable: false),
                    event_name = table.Column<string>(type: "text", nullable: false),
                    policy_id = table.Column<long>(type: "bigint", nullable: true),
                    wallet_address = table.Column<string>(type: "text", nullable: true),
                    args = table.Column<JsonDocument>(type: "jsonb", nullable: false),
                    block_time = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_chain_events", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "evidence_meta",
                columns: table => new
                {
                    policy_id = table.Column<long>(type: "bigint", nullable: false),
                    holder = table.Column<string>(type: "text", nullable: false),
                    declared_lat = table.Column<double>(type: "double precision", nullable: false),
                    declared_lng = table.Column<double>(type: "double precision", nullable: false),
                    gps_accuracy = table.Column<double>(type: "double precision", nullable: false),
                    exif_gps_present = table.Column<bool>(type: "boolean", nullable: false),
                    exif_lat = table.Column<double>(type: "double precision", nullable: true),
                    exif_lng = table.Column<double>(type: "double precision", nullable: true),
                    distance_meters = table.Column<double>(type: "double precision", nullable: true),
                    selfie_hash = table.Column<string>(type: "text", nullable: false),
                    field_hash = table.Column<string>(type: "text", nullable: false),
                    document_hash = table.Column<string>(type: "text", nullable: false),
                    selfie_path = table.Column<string>(type: "text", nullable: false),
                    field_path = table.Column<string>(type: "text", nullable: false),
                    document_path = table.Column<string>(type: "text", nullable: false),
                    locked = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    uploaded_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_evidence_meta", x => x.policy_id);
                });

            migrationBuilder.CreateTable(
                name: "farmer_profiles",
                columns: table => new
                {
                    wallet_address = table.Column<string>(type: "text", nullable: false),
                    full_name = table.Column<string>(type: "text", nullable: false),
                    phone = table.Column<string>(type: "text", nullable: false),
                    email = table.Column<string>(type: "text", nullable: true),
                    province = table.Column<string>(type: "text", nullable: false),
                    district = table.Column<string>(type: "text", nullable: false),
                    commune = table.Column<string>(type: "text", nullable: true),
                    crop_type = table.Column<string>(type: "text", nullable: false),
                    farm_area_ha = table.Column<decimal>(type: "numeric(10,2)", nullable: false),
                    farm_lat = table.Column<decimal>(type: "numeric(9,6)", nullable: true),
                    farm_lng = table.Column<decimal>(type: "numeric(9,6)", nullable: true),
                    notify_email = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    notify_telegram = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    telegram_chat_id = table.Column<long>(type: "bigint", nullable: true),
                    telegram_link_code = table.Column<string>(type: "text", nullable: true),
                    telegram_link_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_farmer_profiles", x => x.wallet_address);
                    table.CheckConstraint("ck_farmer_profiles_farm_area_positive", "farm_area_ha > 0");
                    table.CheckConstraint("ck_farmer_profiles_wallet_lower", "wallet_address = lower(wallet_address)");
                });

            migrationBuilder.CreateTable(
                name: "indexer_state",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    last_block = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_indexer_state", x => x.id);
                    table.CheckConstraint("ck_indexer_state_single_row", "id = 1");
                });

            migrationBuilder.CreateTable(
                name: "notifications",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    wallet_address = table.Column<string>(type: "text", nullable: false),
                    type = table.Column<string>(type: "text", nullable: false),
                    title = table.Column<string>(type: "text", nullable: false),
                    body = table.Column<string>(type: "text", nullable: false),
                    link = table.Column<string>(type: "text", nullable: true),
                    is_read = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notifications", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "oracle_logs",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    region_id = table.Column<string>(type: "text", nullable: false),
                    peril_type = table.Column<short>(type: "smallint", nullable: false),
                    value_scaled = table.Column<BigInteger>(type: "numeric(78,0)", nullable: true),
                    data_ts = table.Column<long>(type: "bigint", nullable: true),
                    tx_hash = table.Column<string>(type: "text", nullable: true),
                    status = table.Column<string>(type: "text", nullable: false),
                    error = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_oracle_logs", x => x.id);
                    table.CheckConstraint("ck_oracle_logs_status", "status in ('ok','error')");
                });

            migrationBuilder.CreateTable(
                name: "policies_cache",
                columns: table => new
                {
                    policy_id = table.Column<long>(type: "bigint", nullable: false),
                    product_id = table.Column<long>(type: "bigint", nullable: false),
                    peril_type = table.Column<short>(type: "smallint", nullable: false),
                    holder = table.Column<string>(type: "text", nullable: false),
                    lat_e6 = table.Column<long>(type: "bigint", nullable: false),
                    lng_e6 = table.Column<long>(type: "bigint", nullable: false),
                    region_id = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<short>(type: "smallint", nullable: false),
                    start_time = table.Column<long>(type: "bigint", nullable: false),
                    end_time = table.Column<long>(type: "bigint", nullable: false),
                    premium_wei = table.Column<BigInteger>(type: "numeric(78,0)", nullable: false),
                    coverage_wei = table.Column<BigInteger>(type: "numeric(78,0)", nullable: false),
                    rejected = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    created_tx = table.Column<string>(type: "text", nullable: true),
                    verified_tx = table.Column<string>(type: "text", nullable: true),
                    payout_tx = table.Column<string>(type: "text", nullable: true),
                    closed_tx = table.Column<string>(type: "text", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_policies_cache", x => x.policy_id);
                });

            migrationBuilder.CreateTable(
                name: "products_cache",
                columns: table => new
                {
                    product_id = table.Column<long>(type: "bigint", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    peril_type = table.Column<short>(type: "smallint", nullable: false),
                    threshold = table.Column<BigInteger>(type: "numeric(78,0)", nullable: false),
                    duration_days = table.Column<int>(type: "integer", nullable: false),
                    premium_wei = table.Column<BigInteger>(type: "numeric(78,0)", nullable: false),
                    coverage_wei = table.Column<BigInteger>(type: "numeric(78,0)", nullable: false),
                    active = table.Column<bool>(type: "boolean", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_products_cache", x => x.product_id);
                });

            migrationBuilder.CreateTable(
                name: "staff",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    email = table.Column<string>(type: "text", nullable: false),
                    password_hash = table.Column<string>(type: "text", nullable: false),
                    full_name = table.Column<string>(type: "text", nullable: false),
                    role = table.Column<string>(type: "text", nullable: false),
                    active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_staff", x => x.id);
                    table.CheckConstraint("ck_staff_role", "role in ('admin','support')");
                });

            migrationBuilder.CreateTable(
                name: "canned_replies",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    title = table.Column<string>(type: "text", nullable: false),
                    body = table.Column<string>(type: "text", nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_canned_replies", x => x.id);
                    table.ForeignKey(
                        name: "fk_canned_replies_staff_created_by",
                        column: x => x.created_by,
                        principalTable: "staff",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "review_logs",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    policy_id = table.Column<long>(type: "bigint", nullable: false),
                    staff_id = table.Column<Guid>(type: "uuid", nullable: true),
                    approved = table.Column<bool>(type: "boolean", nullable: false),
                    note = table.Column<string>(type: "text", nullable: true),
                    tx_hash = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_review_logs", x => x.id);
                    table.ForeignKey(
                        name: "fk_review_logs_staff_staff_id",
                        column: x => x.staff_id,
                        principalTable: "staff",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "tickets",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    wallet_address = table.Column<string>(type: "text", nullable: false),
                    policy_id = table.Column<long>(type: "bigint", nullable: true),
                    category = table.Column<string>(type: "text", nullable: false),
                    subject = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "text", nullable: false, defaultValue: "open"),
                    priority = table.Column<string>(type: "text", nullable: false, defaultValue: "normal"),
                    assigned_to = table.Column<Guid>(type: "uuid", nullable: true),
                    rating = table.Column<short>(type: "smallint", nullable: true),
                    rating_comment = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    closed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tickets", x => x.id);
                    table.CheckConstraint("ck_tickets_category", "category in ('review_rejected','payout_missing','policy_info','technical','other')");
                    table.CheckConstraint("ck_tickets_priority", "priority in ('low','normal','high')");
                    table.CheckConstraint("ck_tickets_rating", "rating between 1 and 5");
                    table.CheckConstraint("ck_tickets_status", "status in ('open','in_progress','waiting_customer','resolved','closed')");
                    table.ForeignKey(
                        name: "fk_tickets_farmer_profiles_wallet_address",
                        column: x => x.wallet_address,
                        principalTable: "farmer_profiles",
                        principalColumn: "wallet_address");
                    table.ForeignKey(
                        name: "fk_tickets_staff_assigned_to",
                        column: x => x.assigned_to,
                        principalTable: "staff",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "ticket_messages",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ticket_id = table.Column<long>(type: "bigint", nullable: false),
                    sender_type = table.Column<string>(type: "text", nullable: false),
                    sender_ref = table.Column<string>(type: "text", nullable: true),
                    body = table.Column<string>(type: "text", nullable: false),
                    is_internal = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_ticket_messages", x => x.id);
                    table.CheckConstraint("ck_ticket_messages_sender_type", "sender_type in ('farmer','staff','system')");
                    table.ForeignKey(
                        name: "fk_ticket_messages_tickets_ticket_id",
                        column: x => x.ticket_id,
                        principalTable: "tickets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_canned_replies_created_by",
                table: "canned_replies",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_chain_events_event_name_block_number",
                table: "chain_events",
                columns: new[] { "event_name", "block_number" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "ix_chain_events_policy_id",
                table: "chain_events",
                column: "policy_id");

            migrationBuilder.CreateIndex(
                name: "ix_chain_events_tx_hash_log_index",
                table: "chain_events",
                columns: new[] { "tx_hash", "log_index" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_notifications_wallet_address_is_read_created_at",
                table: "notifications",
                columns: new[] { "wallet_address", "is_read", "created_at" },
                descending: new[] { false, false, true });

            migrationBuilder.CreateIndex(
                name: "ix_oracle_logs_region_id_peril_type_created_at",
                table: "oracle_logs",
                columns: new[] { "region_id", "peril_type", "created_at" },
                descending: new[] { false, false, true });

            migrationBuilder.CreateIndex(
                name: "ix_policies_cache_holder",
                table: "policies_cache",
                column: "holder");

            migrationBuilder.CreateIndex(
                name: "ix_policies_cache_status",
                table: "policies_cache",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_review_logs_policy_id_created_at",
                table: "review_logs",
                columns: new[] { "policy_id", "created_at" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "ix_review_logs_staff_id",
                table: "review_logs",
                column: "staff_id");

            migrationBuilder.CreateIndex(
                name: "ix_staff_email",
                table: "staff",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_ticket_messages_ticket_id_created_at",
                table: "ticket_messages",
                columns: new[] { "ticket_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_tickets_assigned_to",
                table: "tickets",
                column: "assigned_to");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_status_updated_at",
                table: "tickets",
                columns: new[] { "status", "updated_at" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "ix_tickets_wallet_address",
                table: "tickets",
                column: "wallet_address");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "audit_logs");

            migrationBuilder.DropTable(
                name: "auth_nonces");

            migrationBuilder.DropTable(
                name: "canned_replies");

            migrationBuilder.DropTable(
                name: "chain_events");

            migrationBuilder.DropTable(
                name: "evidence_meta");

            migrationBuilder.DropTable(
                name: "indexer_state");

            migrationBuilder.DropTable(
                name: "notifications");

            migrationBuilder.DropTable(
                name: "oracle_logs");

            migrationBuilder.DropTable(
                name: "policies_cache");

            migrationBuilder.DropTable(
                name: "products_cache");

            migrationBuilder.DropTable(
                name: "review_logs");

            migrationBuilder.DropTable(
                name: "ticket_messages");

            migrationBuilder.DropTable(
                name: "tickets");

            migrationBuilder.DropTable(
                name: "farmer_profiles");

            migrationBuilder.DropTable(
                name: "staff");
        }
    }
}
