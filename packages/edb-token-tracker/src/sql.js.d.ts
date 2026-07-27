declare module "sql.js" {
	export interface SqlJsStatic {
		Database: new (data?: ArrayLike<number> | Buffer | null) => SqlJsDatabase;
	}

	export interface SqlJsDatabase {
		run(sql: string, params?: any[]): void;
		exec(sql: string): void;
		export(): Uint8Array;
		close(): void;
	}

	const initSqlJs: (config?: any) => Promise<SqlJsStatic>;
	export default initSqlJs;
}
