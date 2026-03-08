# Create Start Your Piece destination pages

The Start Your Piece section links to five pages. Create them once so those links work.

## Option A – Run the script (fast)

1. **Get an Admin API token**
   - Shopify Admin → **Settings** → **Apps and sales channels** → **Develop apps** → **Create an app** → **Configure Admin API scopes**
   - Enable **write_online_store_pages** (or **write_content**)
   - **Install app** → **Reveal token once** and copy it

2. **From the theme folder** (where this `scripts` folder lives), run:

   ```bash
   SHOPIFY_STORE=your-store.myshopify.com SHOPIFY_ACCESS_TOKEN=shpat_xxxx node scripts/create-commission-pages.js
   ```

   Replace `your-store` with your store subdomain and `shpat_xxxx` with your token.

3. If a page with that handle already exists, the script skips it. Otherwise it creates the page with the right template.

## Option B – Create pages in Shopify Admin

1. **Online Store** → **Pages** → **Add page** for each:

   | Title            | Handle (URL)        | Theme template        |
   |------------------|---------------------|------------------------|
   | Design Ring      | design-ring         | design-ring            |
   | Commission Pendant | commission-pendant | commission-pendant     |
   | Commission Necklace | commission-necklace | commission-necklace   |
   | Commission Bracelet | commission-bracelet | commission-bracelet   |
   | Custom Inquiry   | custom-inquiry      | custom-inquiry        |

2. Set the **handle** in the page’s **Search engine listing** (or URL) so it matches the table.
3. In **Theme template**, choose the template in the last column.

After that, each option on Start Your Piece will forward to its designated page.
