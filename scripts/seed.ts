/**
 * Idempotent seed (plan-4). Safe to run repeatedly: users are created through
 * better-auth (so password hashing matches) and upserted by email;
 * categories/tags by slug; products by slug (images only on first create).
 *
 * Run: pnpm db:seed   (env loads from the repo root .env)
 */
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });

async function main() {
  const { getEnv } = await import("@ecommerce/config");
  const { db, schema, eq } = await import("@ecommerce/db");
  const { auth } = await import("@ecommerce/auth");
  const { ensureBucket, uploadImage, publicUrl } = await import("@ecommerce/storage");
  const env = getEnv();

  console.log("Seeding…");

  async function ensureUser(
    name: string,
    email: string,
    password: string,
  ): Promise<{ id: string }> {
    try {
      await auth.api.signUpEmail({ body: { name, email, password } });
      console.log(`  created user ${email}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      if (!msg.includes("already exist")) {
        console.warn(`  signup ${email}: ${msg}`);
      }
    }
    await db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.email, email));
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    return user;
  }

  const admin = await ensureUser("Super Admin", env.SUPER_ADMIN_EMAIL, env.SUPER_ADMIN_PASSWORD);
  await db.update(schema.users).set({ role: "super_admin" }).where(eq(schema.users.id, admin.id));

  const seller = await ensureUser("Ada Seller", "seller@dev.local", "Seller1234!");
  const buyer = await ensureUser("Bob Buyer", "buyer@dev.local", "Buyer1234!");

  let [shop] = await db
    .select()
    .from(schema.shops)
    .where(eq(schema.shops.ownerId, seller.id))
    .limit(1);
  if (!shop) {
    [shop] = await db
      .insert(schema.shops)
      .values({
        ownerId: seller.id,
        name: "Nova Gadgets",
        slug: "nova-gadgets",
        description: "Curated electronics and everyday carry, shipped from our own warehouse.",
      })
      .returning();
    await db.update(schema.users).set({ role: "seller" }).where(eq(schema.users.id, seller.id));
    console.log("  created shop nova-gadgets");
  }

  const categoryDefs = [
    { name: "Electronics", slug: "electronics", description: "Gadgets & gear" },
    { name: "Fashion", slug: "fashion", description: "Apparel & accessories" },
    { name: "Home & Living", slug: "home-living", description: "For your space" },
    { name: "Beauty", slug: "beauty", description: "Skincare & cosmetics" },
    { name: "Sports", slug: "sports", description: "Fitness & outdoors" },
    { name: "Toys", slug: "toys", description: "Play & collectibles" },
  ];
  for (const [i, c] of categoryDefs.entries()) {
    await db
      .insert(schema.categories)
      .values({ ...c, sortOrder: i })
      .onConflictDoNothing({ target: schema.categories.slug });
  }
  const allCategories = await db.select().from(schema.categories);
  const categoryBySlug = new Map(allCategories.map((c) => [c.slug, c]));

  const tagDefs = [
    "wireless",
    "bluetooth",
    "smart-home",
    "minimal",
    "budget",
    "premium",
    "portable",
    "waterproof",
    "gift",
    "new-arrival",
    "bestseller",
    "eco-friendly",
  ];
  for (const t of tagDefs) {
    await db
      .insert(schema.tags)
      .values({ name: t, slug: t })
      .onConflictDoNothing({ target: schema.tags.slug });
  }
  const allTags = await db.select().from(schema.tags);
  const tagBySlug = new Map(allTags.map((t) => [t.slug, t]));

  type ProductDef = {
    title: string;
    slug: string;
    description: string;
    priceCents: number;
    stock: number;
    category: string;
    tags: string[];
    status?: "draft" | "active";
  };
  const productDefs: ProductDef[] = [
    {
      title: "Wireless Mechanical Keyboard",
      slug: "wireless-mechanical-keyboard",
      description:
        "Hot-swappable 75% mechanical keyboard with low-latency 2.4GHz wireless, Bluetooth 5.1 and USB-C. Gasket mount, south-facing RGB, and a satisfying thock.",
      priceCents: 8900,
      stock: 42,
      category: "electronics",
      tags: ["wireless", "premium", "bestseller"],
    },
    {
      title: "Noise-Cancelling Over-Ear Headphones",
      slug: "noise-cancelling-over-ear-headphones",
      description:
        "Hybrid active noise cancelling with 40-hour battery, memory-foam earcups and multipoint Bluetooth. Foldable travel design with hard case.",
      priceCents: 14900,
      stock: 25,
      category: "electronics",
      tags: ["bluetooth", "premium", "gift"],
    },
    {
      title: "Smart LED Light Bar",
      slug: "smart-led-light-bar",
      description:
        "Screen-syncing LED light bar with 16M colors, music modes and app control. Workspace bias lighting made simple.",
      priceCents: 4900,
      stock: 80,
      category: "electronics",
      tags: ["smart-home", "gift", "new-arrival"],
    },
    {
      title: "4K Action Camera",
      slug: "4k-action-camera",
      description:
        "Waterproof to 10m without a case, 4K60 video, electronic stabilization and dual batteries for all-day shooting.",
      priceCents: 11900,
      stock: 18,
      category: "electronics",
      tags: ["waterproof", "portable"],
    },
    {
      title: "Minimal Desk Organizer",
      slug: "minimal-desk-organizer",
      description:
        "Powder-coated steel organizer with felt-lined compartments for pens, cables and everyday carry. Keeps the desk quiet.",
      priceCents: 2900,
      stock: 120,
      category: "home-living",
      tags: ["minimal", "eco-friendly"],
    },
    {
      title: "Ceramic Pour-Over Coffee Set",
      slug: "ceramic-pour-over-coffee-set",
      description:
        "Stoneware dripper, carafe and 40 filters. Ribbed geometry for an even extraction and a clean cup.",
      priceCents: 5400,
      stock: 35,
      category: "home-living",
      tags: ["minimal", "gift"],
    },
    {
      title: "Linen Weighted Blanket",
      slug: "linen-weighted-blanket",
      description:
        "Breathable French linen cover over a 6.8kg glass-bead core. Even weight distribution, machine-washable cover.",
      priceCents: 9800,
      stock: 22,
      category: "home-living",
      tags: ["premium", "eco-friendly"],
    },
    {
      title: "Trail Running Backpack 12L",
      slug: "trail-running-backpack-12l",
      description:
        "Featherweight 12L pack with hydration sleeve, bounce-free straps and four stretch pockets.",
      priceCents: 6900,
      stock: 40,
      category: "sports",
      tags: ["portable", "bestseller"],
    },
    {
      title: "Yoga Balance Board",
      slug: "yoga-balance-board",
      description:
        "Wobble board with cork top surface for grip. Builds ankle stability and core strength.",
      priceCents: 3900,
      stock: 55,
      category: "sports",
      tags: ["eco-friendly", "new-arrival"],
    },
    {
      title: "Insulated Water Bottle 750ml",
      slug: "insulated-water-bottle-750ml",
      description:
        "Double-wall vacuum steel keeps cold 24h, hot 12h. Leakproof flip cap and powder-coated finish.",
      priceCents: 2400,
      stock: 200,
      category: "sports",
      tags: ["budget", "bestseller", "portable"],
    },
    {
      title: "Cotton Canvas Weekender Bag",
      slug: "cotton-canvas-weekender-bag",
      description:
        "18oz waxed canvas duffel with full-grain leather trim, YKK zippers and a detachable shoulder strap.",
      priceCents: 10900,
      stock: 15,
      category: "fashion",
      tags: ["premium", "gift"],
    },
    {
      title: "Merino Wool Beanie",
      slug: "merino-wool-beanie",
      description:
        "Rib-knit 100% merino beanie, itch-free and temperature regulating. One size, four colors.",
      priceCents: 3200,
      stock: 90,
      category: "fashion",
      tags: ["minimal", "gift"],
    },
    {
      title: "Polarized Titanium Sunglasses",
      slug: "polarized-titanium-sunglasses",
      description:
        "Feather-light titanium frame with polarized CR-39 lenses and spring hinges. Includes slim case.",
      priceCents: 7600,
      stock: 30,
      category: "fashion",
      tags: ["premium", "portable"],
    },
    {
      title: "Vitamin C Brightening Serum",
      slug: "vitamin-c-brightening-serum",
      description:
        "15% stabilized L-ascorbic acid with ferulic acid and vitamin E. Fragrance-free, 30ml.",
      priceCents: 4200,
      stock: 65,
      category: "beauty",
      tags: ["bestseller", "new-arrival"],
    },
    {
      title: "Argan Oil Hair Mask",
      slug: "argan-oil-hair-mask",
      description:
        "Deep-conditioning mask with cold-pressed argan oil and keratin. Sulfate-free, 250ml.",
      priceCents: 2700,
      stock: 75,
      category: "beauty",
      tags: ["budget", "gift"],
    },
    {
      title: "Wooden Building Blocks Set",
      slug: "wooden-building-blocks-set",
      description:
        "60 sustainably-harvested beech blocks in a canvas bag. Sanded smooth, no paint or glue.",
      priceCents: 4600,
      stock: 48,
      category: "toys",
      tags: ["eco-friendly", "gift", "budget"],
    },
    {
      title: "Beginner Telescope 70mm",
      slug: "beginner-telescope-70mm",
      description:
        "70mm refractor with two eyepieces, smartphone adapter and aluminum tripod. Starter-friendly.",
      priceCents: 9500,
      stock: 12,
      category: "toys",
      tags: ["gift", "new-arrival"],
    },
    {
      title: "Puzzle: Neon City 1000pc",
      slug: "puzzle-neon-city-1000pc",
      description: "1000-piece matte-finish jigsaw with poster included. Recycled board, soy inks.",
      priceCents: 1900,
      stock: 150,
      category: "toys",
      tags: ["budget", "gift"],
    },
    {
      title: "E-Ink Note Tablet",
      slug: "e-ink-note-tablet",
      description:
        '10.3" e-ink note-taking tablet with stylus. Distraction-free writing and PDF annotation.',
      priceCents: 24900,
      stock: 10,
      category: "electronics",
      tags: ["premium"],
      status: "draft",
    },
    {
      title: "Mulberry Silk Scarf",
      slug: "mulberry-silk-scarf",
      description: "22-momme mulberry silk twill scarf, hand-rolled edges. 90×90cm archive print.",
      priceCents: 5900,
      stock: 20,
      category: "fashion",
      tags: ["gift"],
      status: "draft",
    },
  ];

  await ensureBucket();

  for (const def of productDefs) {
    const [existing] = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.slug, def.slug))
      .limit(1);
    if (existing) continue;

    const [product] = await db
      .insert(schema.products)
      .values({
        shopId: shop.id,
        categoryId: categoryBySlug.get(def.category)?.id ?? null,
        title: def.title,
        slug: def.slug,
        description: def.description,
        priceCents: def.priceCents,
        currency: env.CURRENCY,
        stock: def.stock,
        status: def.status ?? "active",
      })
      .returning();

    for (const tagSlug of def.tags) {
      const tag = tagBySlug.get(tagSlug);
      if (tag) {
        await db
          .insert(schema.productTags)
          .values({ productId: product.id, tagId: tag.id })
          .onConflictDoNothing();
      }
    }

    const hue = [...def.slug].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
  <rect width="640" height="480" fill="hsl(${hue}, 45%, 88%)"/>
  <rect x="140" y="110" width="360" height="240" rx="16" fill="hsl(${hue}, 50%, 72%)"/>
  <circle cx="320" cy="230" r="56" fill="hsl(${hue}, 55%, 55%)"/>
  <text x="320" y="420" text-anchor="middle" font-family="sans-serif" font-size="22" fill="hsl(${hue}, 30%, 35%)">${def.title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>
</svg>`;
    const key = `shops/${shop.id}/products/${product.id}/seed-1.svg`;
    try {
      await uploadImage(key, Buffer.from(svg), "image/svg+xml");
      await db.insert(schema.productImages).values({
        productId: product.id,
        key,
        url: publicUrl(key),
        alt: def.title,
        sortOrder: 0,
      });
    } catch (err) {
      console.warn(
        `  image upload skipped for ${def.slug}:`,
        err instanceof Error ? err.message : err,
      );
    }
    console.log(`  product ${def.slug} (${def.status ?? "active"})`);
  }

  console.log("Seed complete.");
  console.log(`  super admin : ${env.SUPER_ADMIN_EMAIL} / ${env.SUPER_ADMIN_PASSWORD}`);
  console.log("  seller      : seller@dev.local / Seller1234!");
  console.log("  buyer       : buyer@dev.local / Buyer1234!");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
