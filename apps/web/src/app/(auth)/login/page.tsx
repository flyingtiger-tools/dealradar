import { Suspense } from "react";
import { LoginForm } from "./login-form";

/** useSearchParams (paramètre ?next=) exige une frontière Suspense au build. */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
