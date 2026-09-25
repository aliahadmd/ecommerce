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

  // ─── Phase 2: product types, attributes, variants, reviews, wishlist ──────
  const { and, sql } = await import("@ecommerce/db")
  const {
    attributeDefinitions, productTypes, productAttributeValues, productVariants,
    variantOptionValues, reviews, wishlistItems, orders, orderItems, users,
    products: productsTable,
  } = schema


  await db.insert(productTypes).values({ name: "Apparel", slug: "apparel" }).onConflictDoNothing({ target: productTypes.slug })
  await db.insert(productTypes).values({ name: "Drinkware", slug: "drinkware" }).onConflictDoNothing({ target: productTypes.slug })
  const [apparelType] = await db.select().from(productTypes).where(eq(productTypes.slug, "apparel")).limit(1)
  const [drinkwareType] = await db.select().from(productTypes).where(eq(productTypes.slug, "drinkware")).limit(1)

  const attrDefs = [
    { productTypeId: apparelType?.id ?? null, name: "Size", slug: "size", kind: "select" as const, options: ["S", "M", "L", "XL"], required: true, useForVariants: true, filterable: true, position: 0 },
    { productTypeId: apparelType?.id ?? null, name: "Color", slug: "color", kind: "select" as const, options: ["Black", "White", "Olive"], required: true, useForVariants: true, filterable: true, position: 1 },
    { productTypeId: apparelType?.id ?? null, name: "Material", slug: "material", kind: "select" as const, options: ["Cotton", "Merino", "Synthetic"], required: false, useForVariants: false, filterable: true, position: 2 },
    { productTypeId: drinkwareType?.id ?? null, name: "Capacity", slug: "capacity", kind: "select" as const, options: ["350ml", "500ml", "750ml"], required: false, useForVariants: true, filterable: true, position: 0 },
    { productTypeId: null, name: "Warranty months", slug: "warranty-months", kind: "number" as const, options: [], required: false, useForVariants: false, filterable: false, position: 0 },
  ]
  for (const def of attrDefs) {
    await db.insert(attributeDefinitions).values(def).onConflictDoNothing()
  }
  const allDefs = await db.select().from(attributeDefinitions)
  const defBySlug = new Map(allDefs.map((d) => [d.slug, d]))
  const sizeDef = defBySlug.get("size")
  const colorDef = defBySlug.get("color")
  const capacityDef = defBySlug.get("capacity")
  const materialDef = defBySlug.get("material")

  const [beanie] = await db.select().from(productsTable).where(eq(productsTable.slug, "merino-wool-beanie")).limit(1)
  const [bottle] = await db.select().from(productsTable).where(eq(productsTable.slug, "insulated-water-bottle-750ml")).limit(1)

  async function ensureVariant(productId: string, sku: string, title: string, priceCents: number, stock: number, options: { attributeId: string; value: string }[], isDefault = false) {
    const [existing] = await db.select().from(productVariants).where(eq(productVariants.sku, sku)).limit(1)
    if (existing) return existing
    const [variant] = await db.insert(productVariants).values({
      productId, sku, title, priceCents, stock, isDefault, status: "active",
    }).returning()
    if (options.length > 0) {
      await db.insert(variantOptionValues).values(options.map((o) => ({ variantId: variant.id, attributeId: o.attributeId, value: o.value })))
    }
    return variant
  }

  if (beanie && sizeDef && colorDef) {
    await db.update(productsTable).set({ productTypeId: apparelType?.id ?? null }).where(eq(productsTable.id, beanie.id))
    // drop the bare "Default" variant left by migration 0009 (no option values)
    await db.execute(sql`
      DELETE FROM product_variants v
      WHERE v.product_id = ${beanie.id}
        AND NOT EXISTS (SELECT 1 FROM variant_option_values o WHERE o.variant_id = v.id)
    `)
    let n = 0
    for (const size of ["S", "M", "L"]) {
      for (const color of ["Black", "Olive"]) {
        await ensureVariant(beanie.id, `BEANIE-${size}-${color.toUpperCase()}`, `${size} / ${color}`, beanie.priceCents + n * 100, 10 + n, [
          { attributeId: sizeDef.id, value: size },
          { attributeId: colorDef.id, value: color },
        ], n === 0)
        n++
      }
    }
    if (materialDef) {
      await db.insert(productAttributeValues).values({ productId: beanie.id, attributeId: materialDef.id, value: "Merino" }).onConflictDoNothing()
    }
    const vs = await db.select().from(productVariants).where(eq(productVariants.productId, beanie.id))
    await db.update(productsTable).set({ priceCents: Math.min(...vs.map((v) => v.priceCents)), stock: vs.reduce((s2, v) => s2 + v.stock, 0) }).where(eq(productsTable.id, beanie.id))
    console.log("  variants for merino-wool-beanie")
  }

  if (bottle && capacityDef) {
    await db.update(productsTable).set({ productTypeId: drinkwareType?.id ?? null }).where(eq(productsTable.id, bottle.id))
    await db.execute(sql`
      DELETE FROM product_variants v
      WHERE v.product_id = ${bottle.id}
        AND NOT EXISTS (SELECT 1 FROM variant_option_values o WHERE o.variant_id = v.id)
    `)
    await ensureVariant(bottle.id, "BOTTLE-350", "350ml", 2000, 40, [{ attributeId: capacityDef.id, value: "350ml" }], false)
    await ensureVariant(bottle.id, "BOTTLE-500", "500ml", 2200, 60, [{ attributeId: capacityDef.id, value: "500ml" }], false)
    await ensureVariant(bottle.id, "BOTTLE-750", "750ml", bottle.priceCents, bottle.stock, [{ attributeId: capacityDef.id, value: "750ml" }], true)
    console.log("  variants for insulated-water-bottle-750ml")
  }

  const [existingSeedOrder] = await db.select().from(orders).where(eq(orders.orderNumber, "ORD-SEED-0001")).limit(1)
  let orderItemId: string | null = null
  if (existingSeedOrder) {
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, existingSeedOrder.id)).limit(1)
    orderItemId = item?.id ?? null
  } else if (buyer && bottle) {
    const [order] = await db.insert(orders).values({
      orderNumber: "ORD-SEED-0001",
      buyerId: buyer.id,
      status: "delivered",
      paymentMethod: "cod",
      paymentStatus: "paid",
      subtotalCents: bottle.priceCents,
      shippingFeeCents: 0,
      totalCents: bottle.priceCents,
      currency: "USD",
      shipName: "Bob Buyer", shipPhone: "+1-555-0100",
      shipLine1: "42 Market Street", shipCity: "San Francisco", shipCountry: "US",
    }).returning()
    const [item] = await db.insert(orderItems).values({
      orderId: order.id, productId: bottle.id, shopId: shop.id,
      title: bottle.title, slug: bottle.slug,
      unitPriceCents: bottle.priceCents, quantity: 1, totalCents: bottle.priceCents,
    }).returning()
    orderItemId = item.id
    console.log("  seed order ORD-SEED-0001 (delivered & paid)")
  }

  const reviewDefs = [
    { productSlug: "insulated-water-bottle-750ml", email: "buyer@dev.local", rating: 5, title: "Keeps cold all day", body: "Filled it at 7am and still had ice at dinner. The flip cap never leaks in my bag." },
    { productSlug: "wireless-mechanical-keyboard", email: "buyer@dev.local", rating: 4, title: "Great thock, minor quibbles", body: "Typing feel is excellent and the wireless is solid. The keycaps could be denser for the price." },
    { productSlug: "merino-wool-beanie", email: "buyer@dev.local", rating: 5, title: "Itch-free and warm", body: "Wore it all winter with zero itch. Holds shape after washing." },
  ]
  for (const def of reviewDefs) {
    const [product] = await db.select().from(productsTable).where(eq(productsTable.slug, def.productSlug)).limit(1)
    const [user] = await db.select().from(users).where(eq(users.email, def.email)).limit(1)
    if (!product || !user) continue
    const [existing] = await db.select().from(reviews).where(and(eq(reviews.productId, product.id), eq(reviews.userId, user.id))).limit(1)
    if (existing) continue
    await db.insert(reviews).values({
      productId: product.id, userId: user.id, orderItemId,
      rating: def.rating, title: def.title, body: def.body,
    }).onConflictDoNothing()
  }
  const ratedProducts = await db.select().from(productsTable)
  for (const p of ratedProducts) {
    const agg = await db.select({
      count: sql<number>`count(*)::int`,
      avg: sql<number | null>`avg(${reviews.rating})`,
    }).from(reviews).where(and(eq(reviews.productId, p.id), eq(reviews.status, "approved")))
    const c = agg[0]?.count ?? 0
    await db.update(productsTable).set({
      ratingCount: c,
      ratingAvgX100: agg[0]?.avg ? Math.round(Number(agg[0].avg) * 100) : 0,
    }).where(eq(productsTable.id, p.id))
  }
  console.log("  reviews + rating aggregates")

  const [kb] = await db.select().from(productsTable).where(eq(productsTable.slug, "wireless-mechanical-keyboard")).limit(1)
  if (buyer && kb) {
    await db.insert(wishlistItems).values({ userId: buyer.id, productId: kb.id }).onConflictDoNothing()
    console.log("  wishlist item for buyer")
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
