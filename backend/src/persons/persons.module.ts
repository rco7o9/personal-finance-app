import { Module } from "@nestjs/common";
import { PersonsController } from "./persons.controller";
import { PersonsService } from "./persons.service";

// A Module bundles a controller and its service(s) together.
// DatabaseModule doesn't need to be imported here because it's @Global().
@Module({
  controllers: [PersonsController],
  providers: [PersonsService],
})
export class PersonsModule {}
