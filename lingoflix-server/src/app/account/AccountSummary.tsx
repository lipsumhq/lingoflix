/** Who is signed in and their plan. Plan 2 replaces "Free" with the real plan status. */
export function AccountSummary({ email }: { email: string }) {
  return (
    <dl className="grid gap-3 rounded-2xl border-2 border-line px-5 py-4">
      <div>
        <dt className="text-sm font-bold text-mute">Email</dt>
        <dd className="font-extrabold">{email}</dd>
      </div>
      <div>
        <dt className="text-sm font-bold text-mute">Plan</dt>
        <dd className="font-extrabold">Free</dd>
      </div>
    </dl>
  );
}
