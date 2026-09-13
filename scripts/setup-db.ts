import { readFileSync } from "node:fs";
import { getPool, closeDb } from "../src/memory/db.js";

const sql = readFileSync("./db/schema.sql", "utf8");
await getPool().query(sql);
console.log("Schema applied.");
await closeDb();
