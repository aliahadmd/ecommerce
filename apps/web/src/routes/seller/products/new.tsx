import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import { createProduct } from "@/server/catalog"
import { ProductForm  } from "@/components/product-form"
import type {ProductFormValues} from "@/components/product-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const Route = createFileRoute("/seller/products/new")({
  component: NewProductPage,
})

function NewProductPage() {
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)

  async function onSubmit(values: ProductFormValues) {
    setPending(true)
    const result = await createProduct({ data: values })
    setPending(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success("Product created — add images next")
    await navigate({
      to: "/seller/products/$id/edit",
      params: { id: result.data.id },
      search: {},
    })
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>New product</CardTitle>
      </CardHeader>
      <CardContent>
        <ProductForm
          defaultValues={{
            title: "",
            description: "",
            price: "",
            stock: "0",
            categoryId: null,
            tagIds: [],
            status: "draft",
          }}
          submitLabel="Create product"
          onSubmit={onSubmit}
          pending={pending}
        />
      </CardContent>
    </Card>
  )
}
