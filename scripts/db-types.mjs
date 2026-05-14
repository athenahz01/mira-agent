import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const outputPath = "lib/db/types.ts";
const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const databasePassword = process.env.SUPABASE_DB_PASSWORD;
const databaseHost =
  process.env.SUPABASE_DB_POOLER_HOST ?? "aws-1-us-east-1.pooler.supabase.com";

if (!projectRef) {
  process.stderr.write("Missing SUPABASE_PROJECT_REF in the environment.\n");
  process.exit(1);
}

if (accessToken) {
  const result = spawnSync(
    "supabase",
    ["gen", "types", "typescript", "--project-id", projectRef],
    {
      encoding: "utf8",
      shell: true,
      env: process.env,
    },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  writeFileSync(outputPath, result.stdout);
  process.stdout.write(`Generated Supabase types at ${outputPath}\n`);
  process.exit(0);
}

if (!databasePassword) {
  process.stderr.write(
    "Missing SUPABASE_ACCESS_TOKEN or SUPABASE_DB_PASSWORD in the environment.\n",
  );
  process.exit(1);
}

const pooledDatabaseUrl = `postgresql://postgres.${projectRef}:${encodeURIComponent(
  databasePassword,
)}@${databaseHost}:5432/postgres?sslmode=require`;

const columns = queryRows(`
  select
    table_name,
    column_name,
    ordinal_position,
    data_type,
    udt_name,
    is_nullable,
    column_default
  from information_schema.columns
  where table_schema = 'public'
  order by table_name, ordinal_position;
`);

const relationships = queryRows(`
  select
    tc.table_name,
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name as foreign_table_name,
    ccu.column_name as foreign_column_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
    and tc.table_schema = kcu.table_schema
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name
    and ccu.table_schema = tc.table_schema
  where tc.constraint_type = 'FOREIGN KEY'
    and tc.table_schema = 'public'
    and ccu.table_schema = 'public'
  order by tc.table_name, tc.constraint_name, kcu.ordinal_position;
`);

writeFileSync(outputPath, renderDatabaseTypes(columns, relationships));
process.stdout.write(
  `Generated Supabase types at ${outputPath} from remote database metadata\n`,
);

function queryRows(sql) {
  const result = spawnSync(
    "supabase",
    ["db", "query", "--db-url", pooledDatabaseUrl, "--output", "json"],
    {
      encoding: "utf8",
      input: sql,
      shell: true,
      env: process.env,
    },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  const start = result.stdout.indexOf("{");
  const end = result.stdout.lastIndexOf("}");

  if (start === -1 || end === -1) {
    process.stderr.write("Unable to parse Supabase query output.\n");
    process.exit(1);
  }

  return JSON.parse(result.stdout.slice(start, end + 1)).rows;
}

function renderDatabaseTypes(columnRows, relationshipRows) {
  const tableNames = [
    ...new Set(columnRows.map((column) => column.table_name)),
  ];
  const columnsByTable = groupBy(columnRows, "table_name");
  const relationshipsByTable = groupBy(relationshipRows, "table_name");
  const lines = [
    "export type Json =",
    "  | string",
    "  | number",
    "  | boolean",
    "  | null",
    "  | { [key: string]: Json | undefined }",
    "  | Json[];",
    "",
    "export type Database = {",
    "  public: {",
    "    Tables: {",
  ];

  for (const tableName of tableNames) {
    const tableColumns = columnsByTable.get(tableName) ?? [];
    lines.push(`      ${tableName}: {`);
    lines.push("        Row: {");
    for (const column of tableColumns) {
      lines.push(
        `          ${column.column_name}: ${nullableType(column, false)};`,
      );
    }
    lines.push("        };");
    lines.push("        Insert: {");
    for (const column of tableColumns) {
      lines.push(
        `          ${column.column_name}${isInsertOptional(column) ? "?" : ""}: ${nullableType(column, true)};`,
      );
    }
    lines.push("        };");
    lines.push("        Update: {");
    for (const column of tableColumns) {
      lines.push(
        `          ${column.column_name}?: ${nullableType(column, true)};`,
      );
    }
    lines.push("        };");
    lines.push("        Relationships: [");
    for (const relationship of relationshipsByTable.get(tableName) ?? []) {
      lines.push("          {");
      lines.push(
        `            foreignKeyName: ${JSON.stringify(relationship.constraint_name)};`,
      );
      lines.push(
        `            columns: [${JSON.stringify(relationship.column_name)}];`,
      );
      lines.push("            isOneToOne: false;");
      lines.push(
        `            referencedRelation: ${JSON.stringify(relationship.foreign_table_name)};`,
      );
      lines.push(
        `            referencedColumns: [${JSON.stringify(relationship.foreign_column_name)}];`,
      );
      lines.push("          },");
    }
    lines.push("        ];");
    lines.push("      };");
  }

  lines.push(
    "    };",
    "    Views: {",
    "      [_ in never]: never;",
    "    };",
    "    Functions: {",
    "      [_ in never]: never;",
    "    };",
    "    Enums: {",
    "      [_ in never]: never;",
    "    };",
    "    CompositeTypes: {",
    "      [_ in never]: never;",
    "    };",
    "  };",
    "};",
    "",
    'type PublicSchema = Database["public"];',
    "",
    'export type Tables<TableName extends keyof PublicSchema["Tables"]> =',
    '  PublicSchema["Tables"][TableName]["Row"];',
    "",
    'export type TablesInsert<TableName extends keyof PublicSchema["Tables"]> =',
    '  PublicSchema["Tables"][TableName]["Insert"];',
    "",
    'export type TablesUpdate<TableName extends keyof PublicSchema["Tables"]> =',
    '  PublicSchema["Tables"][TableName]["Update"];',
    "",
  );

  return `${lines.join("\n")}\n`;
}

function groupBy(rows, key) {
  const grouped = new Map();

  for (const row of rows) {
    const value = row[key];
    const existing = grouped.get(value);

    if (existing) {
      existing.push(row);
    } else {
      grouped.set(value, [row]);
    }
  }

  return grouped;
}

function nullableType(column, allowNull) {
  const type = tsType(column);

  if (allowNull || column.is_nullable === "YES") {
    return column.is_nullable === "YES" ? `${type} | null` : type;
  }

  return type;
}

function isInsertOptional(column) {
  return column.is_nullable === "YES" || column.column_default !== null;
}

function tsType(column) {
  if (column.data_type === "ARRAY") {
    return `${arrayElementType(column.udt_name)}[]`;
  }

  switch (column.udt_name) {
    case "bool":
      return "boolean";
    case "date":
    case "text":
    case "timestamptz":
    case "timestamp":
    case "uuid":
    case "varchar":
      return "string";
    case "float4":
    case "float8":
    case "int2":
    case "int4":
    case "int8":
    case "numeric":
      return "number";
    case "json":
    case "jsonb":
      return "Json";
    default:
      return "Json";
  }
}

function arrayElementType(udtName) {
  switch (udtName) {
    case "_bool":
      return "boolean";
    case "_int2":
    case "_int4":
    case "_int8":
    case "_numeric":
      return "number";
    case "_uuid":
    case "_text":
      return "string";
    case "_json":
    case "_jsonb":
    default:
      return "Json";
  }
}
