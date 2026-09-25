import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import {
  createCategory,
  createTag,
  deleteCategory,
  deleteTag,
  getCategories,
  getTags,
  updateCategory,
} from "@/server/catalog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { unwrap } from "@/lib/unwrap"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/admin/catalog")({
  component: AdminCatalogPage,
})

function AdminCatalogPage() {
  return (
    <Tabs defaultValue="categories">
      <TabsList>
        <TabsTrigger value="categories">Categories</TabsTrigger>
        <TabsTrigger value="tags">Tags</TabsTrigger>
      </TabsList>
      <TabsContent value="categories">
        <CategoriesPanel />
      </TabsContent>
      <TabsContent value="tags">
        <TagsPanel />
      </TabsContent>
    </Tabs>
  )
}

function CategoriesPanel() {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ["categories"], queryFn: () => getCategories().then(unwrap) })
  const categories = data ?? []
  const [editing, setEditing] = useState<{ id?: string; name: string; description: string; parentId: string | null } | null>(null)

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return
      const payload = {
        name: editing.name,
        description: editing.description || undefined,
        parentId: editing.parentId ?? undefined,
      }
      const result = editing.id
        ? await updateCategory({ data: { id: editing.id, ...payload } })
        : await createCategory({ data: payload })
      if (!result.ok) throw new Error(result.error.message)
    },
    onSuccess: () => {
      toast.success("Category saved")
      setEditing(null)
      void queryClient.invalidateQueries({ queryKey: ["categories"] })
    },
    onError: (e) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteCategory({ data: { id } }),
    onSuccess: (result) => {
      if (!result.ok) toast.error(result.error.message)
      else toast.success("Category deleted")
      void queryClient.invalidateQueries({ queryKey: ["categories"] })
    },
  })

  const nameOf = (id: string | null) => categories.find((c) => c.id === id)?.name

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Categories</h1>
        <Button onClick={() => setEditing({ name: "", description: "", parentId: null })}>
          New category
        </Button>
      </div>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Parent</TableHead>
              <TableHead>Products</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{c.slug}</TableCell>
                <TableCell>{nameOf(c.parentId) ?? "—"}</TableCell>
                <TableCell>—</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      setEditing({
                        id: c.id,
                        name: c.name,
                        description: c.description ?? "",
                        parentId: c.parentId,
                      })
                    }
                  >
                    Edit
                  </Button>{" "}
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => remove.mutate(c.id)}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit category" : "New category"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="cat-name">Name</Label>
                <Input
                  id="cat-name"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cat-desc">Description</Label>
                <Textarea
                  id="cat-desc"
                  rows={2}
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Parent (optional)</Label>
                <Select
                  value={editing.parentId ?? "none"}
                  onValueChange={(v) => setEditing({ ...editing, parentId: v === "none" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Top level</SelectItem>
                    {categories
                      .filter((c) => c.id !== editing.id)
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !editing?.name}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TagsPanel() {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ["tags"], queryFn: () => getTags().then(unwrap) })
  const tags = data ?? []
  const [newName, setNewName] = useState("")

  const create = useMutation({
    mutationFn: (name: string) => createTag({ data: { name } }),
    onSuccess: (result) => {
      if (!result.ok) toast.error(result.error.message)
      else {
        toast.success("Tag created")
        setNewName("")
        void queryClient.invalidateQueries({ queryKey: ["tags"] })
      }
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteTag({ data: { id } }),
    onSuccess: (result) => {
      if (!result.ok) toast.error(result.error.message)
      void queryClient.invalidateQueries({ queryKey: ["tags"] })
    },
  })

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Tags</h1>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (newName.trim()) create.mutate(newName.trim())
        }}
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New tag name…"
          className="max-w-64"
        />
        <Button type="submit" variant="outline">
          Add tag
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm"
          >
            {t.name}
            <button
              className="text-muted-foreground hover:text-destructive"
              onClick={() => remove.mutate(t.id)}
              aria-label={`Delete ${t.name}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}
