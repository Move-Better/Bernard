// A Clerk org invitation lands on the workspace subdomain with `__clerk_ticket`
// and `__clerk_status` in the query string. A brand-new person arrives with
// status "sign_up" and must see the SignUp form (Clerk's prebuilt component
// redeems the ticket itself); a person who already has an account arrives with
// "sign_in". Showing <SignIn> to a new person sends them to the apex /onboard
// wizard, the "new business" page.
export function inviteAuthMode(search) {
  const p = new URLSearchParams(search || '')
  if (!p.get('__clerk_ticket')) return 'signin'
  return p.get('__clerk_status') === 'sign_up' ? 'signup' : 'signin'
}
