import { useEffect, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { CategoryIcon, iconLabel } from '../components/CategoryIcon';
import { Alert, Badge, Button, Card, ConfirmDialog, cx, EmptyState, Field, IconButton, Input, Modal, PageHeader, Spinner, Switch, Table, Td, Textarea, Th, useToast } from '../components/ui';
import { del, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatNumber } from '../lib/format';
import type { Category } from '../lib/types';
import { useApi } from '../lib/useApi';

interface CategoriesResponse {
  categories: Category[];
  unmanaged: { label: string; habitCount: number; studentCount: number }[];
  icons: string[];
}

const SWATCHES = ['#E58D8D', '#7A6AED', '#4BA3FF', '#57B991', '#F2A541', '#E573B5', '#3FB8C7', '#8C8C8C'];

function CategoryModal({ open, category, icons, onClose, onSaved }: {
  open: boolean;
  category: Category | null;
  icons: string[];
  onClose: () => void;
  onSaved: (data: CategoriesResponse) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ label: '', icon: 'ellipse-outline', color: '#7A6AED', description: '', isActive: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(category
      ? { label: category.label, icon: category.icon, color: category.color, description: category.description, isActive: category.isActive }
      : { label: '', icon: icons[0] ?? 'heart-outline', color: SWATCHES[1], description: '', isActive: true });
  }, [open, category, icons]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = category
        ? await patch<CategoriesResponse>(`/categories/${category.id}`, form)
        : await post<CategoriesResponse>('/categories', form);
      onSaved(result);
      toast(category ? 'Category updated.' : 'Category created.');
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the category.');
    } finally {
      setBusy(false);
    }
  }

  const inUse = Boolean(category && category.habitCount > 0);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={category ? 'Edit category' : 'New category'}
      description="Categories appear in the “Add habit” screen of the HabitAI app."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="category-form" loading={busy}>{category ? 'Save changes' : 'Create category'}</Button></>}
    >
      <form id="category-form" onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="critical">{error}</Alert>}
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
          <CategoryIcon name={form.icon} color={form.color} size={44} />
          <div>
            <p className="text-sm font-semibold text-ink">{form.label || 'Category name'}</p>
            <p className="text-xs text-muted">{form.description || 'Short description for administrators'}</p>
          </div>
        </div>
        <Field label="Name" htmlFor="cat-label" hint={inUse ? `Used by ${category!.habitCount} habit(s): the name is locked so existing habits keep their category.` : undefined}>
          <Input id="cat-label" required maxLength={40} value={form.label} disabled={inUse} onChange={(event) => setForm({ ...form, label: event.target.value })} />
        </Field>
        <Field label="Description" htmlFor="cat-description">
          <Textarea id="cat-description" rows={2} maxLength={200} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink">Icon</legend>
          <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-11">
            {icons.map((icon) => (
              <button
                key={icon}
                type="button"
                title={iconLabel(icon)}
                aria-label={iconLabel(icon)}
                aria-pressed={form.icon === icon}
                onClick={() => setForm({ ...form, icon })}
                className={cx('flex items-center justify-center rounded-lg border p-1', form.icon === icon ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-surface-hover')}
              >
                <CategoryIcon name={icon} color={form.icon === icon ? form.color : 'var(--ink-2)'} size={30} />
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink">Color in the app</legend>
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Color ${swatch}`}
                aria-pressed={form.color.toUpperCase() === swatch}
                onClick={() => setForm({ ...form, color: swatch })}
                className={cx('size-7 rounded-full border-2', form.color.toUpperCase() === swatch ? 'border-ink' : 'border-transparent')}
                style={{ background: swatch }}
              />
            ))}
            <label className="ml-1 inline-flex items-center gap-2 text-[13px] text-ink-2">
              Custom
              <input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value.toUpperCase() })} className="h-7 w-10 cursor-pointer rounded border border-line bg-transparent" />
            </label>
          </div>
        </fieldset>
        <div className="flex items-center justify-between rounded-lg border border-line p-3">
          <div>
            <p className="text-sm font-medium text-ink">Available in the app</p>
            <p className="text-xs text-muted">Inactive categories are hidden when students create new habits. Existing habits keep them.</p>
          </div>
          <Switch label="Available in the app" checked={form.isActive} onChange={(value) => setForm({ ...form, isActive: value })} />
        </div>
      </form>
    </Modal>
  );
}

export function CategoriesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can('categories:manage');
  const { data, error, loading, setData } = useApi<CategoriesResponse>('/categories');
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(task: () => Promise<CategoriesResponse>, message: string) {
    setBusy(true);
    try {
      setData(await task());
      toast(message);
      return true;
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Action failed.', 'critical');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, direction: -1 | 1) {
    if (!data) return;
    const ids = data.categories.map((category) => category.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + direction, 0, moved);
    void act(() => post<CategoriesResponse>('/categories/reorder', { ids }), 'Order updated.');
  }

  const categories = data?.categories ?? [];
  return (
    <>
      <PageHeader
        title="Habit categories"
        description="System-wide categories students choose from when creating a habit. Changes reach the app the next time the Add habit screen opens."
        actions={manage && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New category</Button>}
      />
      {error && <div className="mb-4"><Alert tone="critical">{error}</Alert></div>}
      {!data ? (loading && <Spinner />) : (
        <div className="flex flex-col gap-5">
          <Card bodyClassName="!p-0">
            {categories.length === 0 ? <EmptyState icon={<Tags className="size-8" />} title="No categories" /> : (
              <Table>
                <thead>
                  <tr>
                    {manage && <Th className="w-20">Order</Th>}
                    <Th>Category</Th>
                    <Th>Status</Th>
                    <Th align="right">Habits</Th>
                    <Th align="right">Students</Th>
                    <Th align="right">Check-ins (30 days)</Th>
                    {manage && <Th><span className="sr-only">Actions</span></Th>}
                  </tr>
                </thead>
                <tbody className={cx(busy && 'opacity-60')}>
                  {categories.map((category, index) => (
                    <tr key={category.id}>
                      {manage && (
                        <Td>
                          <div className="flex gap-0.5">
                            <IconButton label={`Move ${category.label} up`} disabled={index === 0 || busy} onClick={() => move(index, -1)}><ArrowUp className="size-4" /></IconButton>
                            <IconButton label={`Move ${category.label} down`} disabled={index === categories.length - 1 || busy} onClick={() => move(index, 1)}><ArrowDown className="size-4" /></IconButton>
                          </div>
                        </Td>
                      )}
                      <Td>
                        <div className="flex min-w-56 items-center gap-3">
                          <CategoryIcon name={category.icon} color={category.color} />
                          <div className="min-w-0">
                            <p className="font-medium text-ink">{category.label}</p>
                            <p className="truncate text-xs text-muted">{category.description || '—'}</p>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        {manage ? (
                          <div className="flex items-center gap-2">
                            <Switch
                              label={`${category.label} available in the app`}
                              checked={category.isActive}
                              disabled={busy}
                              onChange={(value) => void act(() => patch<CategoriesResponse>(`/categories/${category.id}`, { isActive: value }), value ? `${category.label} is now available.` : `${category.label} was hidden from the app.`)}
                            />
                            <span className="text-xs text-ink-2">{category.isActive ? 'Active' : 'Hidden'}</span>
                          </div>
                        ) : category.isActive ? <Badge tone="good">Active</Badge> : <Badge>Hidden</Badge>}
                      </Td>
                      <Td align="right">{formatNumber(category.habitCount)}</Td>
                      <Td align="right">{formatNumber(category.studentCount)}</Td>
                      <Td align="right">{formatNumber(category.completions30d)}</Td>
                      {manage && (
                        <Td align="right">
                          <div className="flex justify-end gap-0.5">
                            <IconButton label={`Edit ${category.label}`} onClick={() => setEditing(category)}><Pencil className="size-4" /></IconButton>
                            <IconButton
                              label={category.habitCount ? `${category.label} is in use and cannot be deleted` : `Delete ${category.label}`}
                              disabled={category.habitCount > 0}
                              onClick={() => setDeleting(category)}
                            >
                              <Trash2 className="size-4" />
                            </IconButton>
                          </div>
                        </Td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {data.unmanaged.length > 0 && (
            <Alert tone="warning" title="Habits using categories that are not in this list">
              {data.unmanaged.map((item) => `${item.label || 'Uncategorized'} (${item.habitCount} habit${item.habitCount === 1 ? '' : 's'})`).join(', ')}.
              {' '}These come from older app versions or renamed categories. Create a category with the same name to manage them here.
            </Alert>
          )}

          <Alert title="How categories reach the app">
            The HabitAI app loads active categories from the backend (<code className="text-ink">GET /api/habit-categories</code>) and falls back to its built-in list when offline.
            Categories that are in use cannot be renamed or deleted, so students' existing habits and analytics stay consistent.
          </Alert>
        </div>
      )}

      <CategoryModal open={creating || Boolean(editing)} category={editing} icons={data?.icons ?? []} onClose={() => { setCreating(false); setEditing(null); }} onSaved={setData} />
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete category"
        confirmLabel="Delete"
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { if (deleting && await act(() => del<CategoriesResponse>(`/categories/${deleting.id}`), `${deleting.label} was deleted.`)) setDeleting(null); }}
      >
        Delete <strong className="text-ink">{deleting?.label}</strong>? No habits use it, so nothing else changes.
      </ConfirmDialog>
    </>
  );
}
