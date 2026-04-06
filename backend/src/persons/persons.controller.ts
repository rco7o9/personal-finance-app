import { Controller, Get, Post, Body } from "@nestjs/common"
import { PersonsService } from "./persons.service"
import { CreatePersonDto } from "./dto/create-person.dto"

// @Controller("persons") sets the route prefix — all methods here are under /persons
@Controller("persons")
export class PersonsController {
  // NestJS injects PersonsService automatically via the constructor.
  // You never call `new PersonsService()` — the DI container does it.
  constructor(private readonly personsService: PersonsService) {}

  // GET /persons
  @Get()
  findAll() {
    return this.personsService.findAll()
  }

  // POST /persons
  // @Body() extracts and validates the request body against CreatePersonDto.
  // If validation fails, NestJS returns 400 before this method is even called.
  @Post()
  create(@Body() dto: CreatePersonDto) {
    return this.personsService.create(dto)
  }
}
