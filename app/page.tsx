import { redirect } from "next/navigation";

// The public portal was retired — the analyst dashboard is the app.
export default function Home() {
  redirect("/analyst");
}
