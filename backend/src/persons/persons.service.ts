import { Injectable, Inject } from "@nestjs/common"
import { Pool } from "pg"
import { CreatePersonDto } from "./dto/create-person.dto"

// @Injectable() marks this class as a provider that NestJS can inject into
// controllers or other services. The DI container handles instantiation.
@Injectable()
export class PersonsService {
  // @Inject("DB_POOL") tells NestJS to look up the provider registered under
  // the token "DB_POOL" (defined in DatabaseModule) and pass it here.
  constructor(@Inject("DB_POOL") private readonly pool: Pool) {}

  async findAll() {
    const result = await this.pool.query(
      "SELECT id, name, home_id FROM person ORDER BY name",
    )
    return result.rows
  }

  async create(dto: CreatePersonDto) {
    const result = await this.pool.query(
      "INSERT INTO person (name, home_id) VALUES ($1, $2) RETURNING id, name, home_id",
      [dto.name, dto.homeId],
    )
    return result.rows[0]
  }
}
