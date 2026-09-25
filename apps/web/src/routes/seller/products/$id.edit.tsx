import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { z } from "zod"
import { toast } from "sonner"
import { centsToDecimalString } from "@ecommerce/config"
import { getProductForEdit, updateProduct } from "@/server/catalog"
import { ProductForm } from "@/components/product-form"
import type { ProductFormValues } from "@/components/product-form"
import { ImageUploader } from "@/components/image-uploader"
import { SellerVariants } from "@/components/seller-variants"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { unwrap } from "@/lib/unwrap"

export const Route = createFileRoute("/seller/products/$id/edit")({
  validateSearch: z.object({}),
  beforeLoad: ({ context }) => {
    if (context.session?.role === "buyer") {
      throw redirect({ to: "/seller/onboarding" })
    }
  },
  component: EditProductPage,
})

function EditProductPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)

  const { data, isError, error } = useQuery({
    queryKey: ["product-edit", id],
    queryFn: () => getProductForEdit({ data: { id } }).then(unwrap),
  })
  if (isError) {
    return <p className="py-8 text-destructive">{error.message}</p>
  }

  async function onSubmit(values: ProductFormValues) {
    setPending(true)
    const result = await updateProduct({ data: { id, ...values } })
    setPending(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success("Product saved")
    void queryClient.invalidateQueries({ queryKey: ["seller-products"] })
    void queryClient.invalidateQueries({
      queryKey: ["product", result.data.slug],
    })
    await navigate({ to: "/seller/products", search: { page: 1 } })
  }

  if (!data) {
    return <Skeleton className="mx-auto h-96 max-w-2xl" />
  }

  const { product, images, tagIds, attributes } = data
  const [variantCount, setVariantCount] = useState<number | null>(null)

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Edit product</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h2 className="mb-2 text-sm font-medium">Images</h2>
          <ImageUploader productId={id} images={images} />
        </div>
        <div className="border-t pt-4">
          <SellerVariants productId={id} hasProductType={product.productTypeId !== null} onCountChange={setVariantCount} />
        </div>
        <ProductForm
          hidePriceStock={(variantCount ?? 0) > 0}
          defaultValues={{
            title: product.title,
            description: product.description,
            price: centsToDecimalString(product.priceCents),
            stock: String(product.stock),
            categoryId: product.categoryId,
            tagIds,
            status: product.status === "active" ? "active" : "draft",
            brand: product.brand ?? "",
            summary: product.summary ?? "",
            condition: product.condition,
            weightGrams: product.weightGrams === null ? "" : String(product.weightGrams),
            dimensions: {
              l: String(product.dimensions?.l ?? ""),
              w: String(product.dimensions?.w ?? ""),
              h: String(product.dimensions?.h ?? ""),
            },
            seoTitle: product.seoTitle ?? "",
            seoDescription: product.seoDescription ?? "",
            lowStockThreshold: String(product.lowStockThreshold),
            productTypeId: product.productTypeId,
            attributes: attributes.map((a) => ({ attributeId: a.attributeId, value: a.value })),
          }}
          submitLabel="Save changes"
          onSubmit={onSubmit}
          pending={pending}
        />
      </CardContent>
    </Card>
  )
}
