import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  uploadProductImage,
  deleteProductImage,
  setPrimaryImage,
} from "@/server/uploads"
import { Progress } from "@/components/ui/progress"

interface ImageRow {
  id: string
  url: string
  alt: string | null
}

/**
 * Uploads immediately (proxy through server function — plan-6 decision).
 * First image by sort order is the primary; "Make primary" reorders.
 */
export function ImageUploader({
  productId,
  images,
}: {
  productId: string
  images: ImageRow[]
}) {
  const queryClient = useQueryClient()

  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      let uploaded = 0
      const failed: string[] = []
      for (const file of files) {
        const fd = new FormData()
        fd.set("productId", productId)
        fd.set("file", file)
        const result = await uploadProductImage({ data: fd })
        if (result.ok) uploaded++
        else failed.push(file.name)
      }
      if (failed.length > 0) {
        throw new Error(
          `Uploaded ${uploaded}/${files.length}. Failed: ${failed.join(", ")}`
        )
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["product-edit", productId],
      })
      void queryClient.invalidateQueries({ queryKey: ["product", productId] })
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: (imageId: string) => deleteProductImage({ data: { imageId } }),
    onSuccess: (result) => {
      if (!result.ok) toast.error(result.error.message)
      void queryClient.invalidateQueries({
        queryKey: ["product-edit", productId],
      })
      void queryClient.invalidateQueries({ queryKey: ["product", productId] })
    },
  })

  const makePrimary = useMutation({
    mutationFn: (imageId: string) =>
      setPrimaryImage({ data: { productId, imageId } }),
    onSuccess: (result) => {
      if (!result.ok) toast.error(result.error.message)
      void queryClient.invalidateQueries({
        queryKey: ["product-edit", productId],
      })
      void queryClient.invalidateQueries({ queryKey: ["product", productId] })
    },
  })

  return (
    <div>
      <div className="grid grid-cols-5 gap-2">
        {images.map((img, i) => (
          <div
            key={img.id}
            className="group relative aspect-square overflow-hidden rounded-lg bg-muted"
          >
            <img
              src={img.url}
              alt={img.alt ?? ""}
              className="h-full w-full object-cover"
            />
            {i === 0 && (
              <span className="absolute top-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
                primary
              </span>
            )}
            <div className="absolute inset-x-0 bottom-0 hidden justify-between gap-1 bg-black/50 p-1 group-hover:flex">
              {i !== 0 && (
                <button
                  type="button"
                  className="text-[10px] text-white hover:underline"
                  onClick={() => makePrimary.mutate(img.id)}
                >
                  primary
                </button>
              )}
              <button
                type="button"
                className="text-[10px] text-red-300 hover:underline"
                onClick={() => remove.mutate(img.id)}
              >
                delete
              </button>
            </div>
          </div>
        ))}
        {images.length < 8 && (
          <label className="flex aspect-square cursor-pointer items-center justify-center rounded-lg border border-dashed border-input bg-muted/30 text-xs text-muted-foreground hover:bg-muted">
            {upload.isPending ? (
              <Progress value={30} className="w-8" />
            ) : (
              "+ add"
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) upload.mutate(e.target.files)
                e.target.value = ""
              }}
            />
          </label>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        JPEG/PNG/WebP, up to 5MB, max 8 images. First image is the product
        photo.
      </p>
    </div>
  )
}
