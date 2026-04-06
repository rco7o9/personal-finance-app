import { redirect } from "next/navigation";

// Root "/" redirects to "/dashboard" — the app's default landing page.
// redirect() is a server-side function — no client JS needed.
export default function Home() {
  redirect("/dashboard");
}
