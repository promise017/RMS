import Link from "next/link";

// Plain, focused frame for sign-in, sign-up and joining a building
export default function AuthLayout({ children }) {
  return (
    <div className="auth">
      <Link href="/" className="wordmark">griha<span>.</span></Link>
      <div className="auth-body">
        <div className="auth-card">{children}</div>
      </div>
      <p className="auth-foot">Building management for secretaries, residents and guards.</p>
    </div>
  );
}
