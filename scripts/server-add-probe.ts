import path from "node:path"
import dotenv from "dotenv"
dotenv.config({ path: path.resolve(process.cwd(), ".env") })

async function main() {
  const { db, schema, eq } = await import("@ecommerce/db")
  const [buyer] = await db.select().from(schema.users).where(eq(schema.users.email, "buyer@dev.local")).limit(1)
  const [cart] = await db.select().from(schema.carts).where(eq(schema.carts.userId, buyer.id)).limit(1)
  const [variant] = await db.select().from(schema.productVariants).where(eq(schema.productVariants.sku, "BEANIE-L-BLACK")).limit(1)
  console.log("variant:", variant?.sku)
  await db.insert(schema.cartItems).values({
    cartId: cart.id,
    productId: variant.productId,
    variantId: variant.id,
    quantity: 2,
  })
  const rows = await db
    .select({ q: schema.cartItems.quantity, v: schema.cartItems.variantId, sku: schema.productVariants.sku })
    .from(schema.cartItems)
    .leftJoin(schema.productVariants, eq(schema.cartItems.variantId, schema.productVariants.id))
    .where(eq(schema.cartItems.cartId, cart.id))
  console.log("cart rows:", JSON.stringify(rows))
  process.exit(0)
}
main()
