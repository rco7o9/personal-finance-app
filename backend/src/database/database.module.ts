import { Module, Global } from "@nestjs/common";
import { Pool } from "pg";

// @Global() makes this module's exports available everywhere without
// needing to import DatabaseModule in every feature module.
// This is appropriate for a single shared resource like a DB pool.
@Global()
@Module({
  providers: [
    {
      // "DB_POOL" is the injection token — a string key used to identify
      // this provider. Feature services inject it with @Inject("DB_POOL").
      provide: "DB_POOL",
      useFactory: () => {
        return new Pool({
          connectionString: process.env.DATABASE_URL,
          // max: how many simultaneous Postgres connections to keep open.
          // Each request that hits the DB borrows one connection from the pool
          // and returns it when done. For a personal app, 10 is plenty.
          max: 10,
        });
      },
    },
  ],
  exports: ["DB_POOL"],
})
export class DatabaseModule {}
