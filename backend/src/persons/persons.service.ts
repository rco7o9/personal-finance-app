import { Injectable, Inject } from "@nestjs/common";
import { Pool } from "pg";
import { CreatePersonDto } from "./dto/create-person.dto";

// The shape of a row returned from the person table.
// Once we add pgtyped this will be auto-generated from the .sql file instead.
type PersonRow = {
  id: number;
  name: string;
  home_id: number;
};

@Injectable()
export class PersonsService {
  constructor(@Inject("DB_POOL") private readonly pool: Pool) {}

  async findAll(): Promise<PersonRow[]> {
    // The generic on pool.query<T> tells pg what shape each row has,
    // which makes result.rows typed as T[] instead of any[].
    const result = await this.pool.query<PersonRow>(
      "SELECT id, name, home_id FROM person ORDER BY name",
    );
    return result.rows;
  }

  async create(dto: CreatePersonDto): Promise<PersonRow> {
    const result = await this.pool.query<PersonRow>(
      "INSERT INTO person (name, home_id) VALUES ($1, $2) RETURNING id, name, home_id",
      [dto.name, dto.homeId],
    );
    return result.rows[0];
  }
}
