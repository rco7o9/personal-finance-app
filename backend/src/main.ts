import { NestFactory } from "@nestjs/core"
import { ValidationPipe } from "@nestjs/common"
import { AppModule } from "./app.module"

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  // CORS: allow the Next.js frontend (port 3000) to call this API from the browser.
  // Without this, the browser blocks cross-origin requests (different port = different origin).
  app.enableCors({ origin: "http://localhost:3000" })

  // Global validation pipe — applies to every controller automatically.
  // whitelist: true  → strips any fields not declared in the DTO (prevents mass assignment)
  // transform: true  → converts plain JSON objects into DTO class instances so @IsString() etc. run
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  const port = process.env.PORT ?? 3001
  await app.listen(port)
  console.log(`Backend running on http://localhost:${port}`)
}
bootstrap()
