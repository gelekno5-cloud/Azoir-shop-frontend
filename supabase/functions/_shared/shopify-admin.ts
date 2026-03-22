// Shopify Admin API helper — uses client credentials flow (dev dashboard app)
// Token expires every 24h; we fetch a fresh one per invocation.

const STORE_DOMAIN = Deno.env.get('SHOPIFY_STORE_DOMAIN') ?? ''
const CLIENT_ID    = Deno.env.get('SHOPIFY_CLIENT_ID') ?? ''
const CLIENT_SECRET = Deno.env.get('SHOPIFY_CLIENT_SECRET') ?? ''
const API_VERSION  = '2025-01'

async function getAccessToken(): Promise<string> {
  const res = await fetch(
    `https://${STORE_DOMAIN}/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type:    'client_credentials',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    }
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Shopify token request failed: ${res.status} ${text}`)
  }

  const { access_token } = await res.json()
  return access_token
}

async function shopifyFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken()
  return fetch(`https://${STORE_DOMAIN}/admin/api/${API_VERSION}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
      ...(options.headers ?? {}),
    },
  })
}

// ── Customer tag helpers ───────────────────────────────────────────────────────

export async function getCustomerTags(shopifyCustomerId: string): Promise<string[]> {
  const res = await shopifyFetch(`/customers/${shopifyCustomerId}.json`)
  if (!res.ok) throw new Error(`Failed to fetch customer ${shopifyCustomerId}: ${res.status}`)
  const { customer } = await res.json()
  return (customer.tags as string).split(',').map((t: string) => t.trim()).filter(Boolean)
}

export async function addCustomerTag(shopifyCustomerId: string, tag: string): Promise<void> {
  const existing = await getCustomerTags(shopifyCustomerId)
  if (existing.includes(tag)) return

  const res = await shopifyFetch(`/customers/${shopifyCustomerId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ customer: { id: shopifyCustomerId, tags: [...existing, tag].join(', ') } }),
  })
  if (!res.ok) throw new Error(`Failed to add tag "${tag}" to customer ${shopifyCustomerId}: ${res.status}`)
}

export async function removeCustomerTag(shopifyCustomerId: string, tag: string): Promise<void> {
  const existing = await getCustomerTags(shopifyCustomerId)
  const updated = existing.filter(t => t !== tag)
  if (updated.length === existing.length) return // tag wasn't present

  const res = await shopifyFetch(`/customers/${shopifyCustomerId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ customer: { id: shopifyCustomerId, tags: updated.join(', ') } }),
  })
  if (!res.ok) throw new Error(`Failed to remove tag "${tag}" from customer ${shopifyCustomerId}: ${res.status}`)
}

export async function customerHasTag(shopifyCustomerId: string, tag: string): Promise<boolean> {
  const tags = await getCustomerTags(shopifyCustomerId)
  return tags.includes(tag)
}
