/**
 * Creates the 5 commission pages so Start Your Piece links work.
 *
 * Usage (from theme root):
 *   Set env vars then run with Node 18+:
 *   SHOPIFY_STORE=your-store.myshopify.com SHOPIFY_ACCESS_TOKEN=shpat_xxx node scripts/create-commission-pages.js
 *
 * Get an Admin API token: Shopify Admin → Settings → Apps and sales channels → Develop apps
 * → Create app → Configure Admin API scopes (enable write_online_store_pages or write_content) → Install app → Reveal token
 */

const store = process.env.SHOPIFY_STORE?.replace(/^https?:\/\//, '').replace(/\/$/, '');
const token = process.env.SHOPIFY_ACCESS_TOKEN;

if (!store || !token) {
  console.error('Set SHOPIFY_STORE and SHOPIFY_ACCESS_TOKEN.');
  console.error('Example: SHOPIFY_STORE=your-store.myshopify.com SHOPIFY_ACCESS_TOKEN=shpat_xxx node scripts/create-commission-pages.js');
  process.exit(1);
}

const PAGES = [
  { title: 'Design Ring', handle: 'design-ring', templateSuffix: 'design-ring', body: '<p>Commission a bespoke ring.</p>' },
  { title: 'Commission Pendant', handle: 'commission-pendant', templateSuffix: 'commission-pendant', body: '<p>Commission a pendant.</p>' },
  { title: 'Commission Necklace', handle: 'commission-necklace', templateSuffix: 'commission-necklace', body: '<p>Commission a necklace.</p>' },
  { title: 'Commission Bracelet', handle: 'commission-bracelet', templateSuffix: 'commission-bracelet', body: '<p>Commission a bracelet.</p>' },
  { title: 'Custom Inquiry', handle: 'custom-inquiry', templateSuffix: 'custom-inquiry', body: '<p>Submit a custom or stone-set design inquiry.</p>' },
];

const mutation = `mutation CreatePage($page: PageCreateInput!) {
  pageCreate(page: $page) {
    page { id title handle }
    userErrors { code field message }
  }
}`;

const url = `https://${store}/admin/api/2024-10/graphql.json`;

async function createPage(page) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        page: {
          title: page.title,
          handle: page.handle,
          body: page.body,
          isPublished: true,
          templateSuffix: page.templateSuffix,
        },
      },
    }),
  });
  const json = await res.json();
  const out = json.data?.pageCreate;
  if (out?.userErrors?.length) {
    if (out.userErrors.some((e) => e.code === 'TAKEN' || e.message?.includes('taken'))) {
      return { skipped: true, handle: page.handle };
    }
    throw new Error(JSON.stringify(out.userErrors));
  }
  return { page: out.page };
}

(async () => {
  for (const p of PAGES) {
    try {
      const result = await createPage(p);
      if (result.skipped) {
        console.log(`Page already exists: ${p.handle} (skipped)`);
      } else {
        console.log(`Created: ${result.page.title} → /pages/${result.page.handle}`);
      }
    } catch (e) {
      console.error(`Failed to create ${p.handle}:`, e.message);
    }
  }
})();
