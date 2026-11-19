/** Loads the repository's .env (DATABASE_URL, PGLITE_DIR, ANTHROPIC_API_KEY...) before anything reads process.env. */
import path from "node:path";
import dotenv from "dotenv";
import { REPO_ROOT } from "./paths";

dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
