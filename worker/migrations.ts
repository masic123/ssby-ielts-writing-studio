import initial from "./schema";
import targetPreferences from "./target-preferences-schema";
export const migrations = [{ version: 1, sql: initial }, { version: 2, sql: targetPreferences }];
