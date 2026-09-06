import Link from 'next/link'

export default function PortalNotFound() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-3 bg-white shadow-sm rounded-md p-8">
        <h1 className="text-2xl font-bold">Link no longer valid</h1>
        <p className="text-sm text-muted-foreground">
          This link may have expired, been revoked, or the request may have been completed.
          Please contact your engagement team for a fresh invitation.
        </p>
        <p className="text-[11px] text-muted-foreground">
          If you were sent this link and believe it should still work,
          reply to the email that contained it.
        </p>
        <div>
          <Link href="/" className="text-xs underline">Return home</Link>
        </div>
      </div>
    </main>
  )
}
