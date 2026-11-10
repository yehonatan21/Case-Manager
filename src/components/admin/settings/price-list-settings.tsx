"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { formatMoney } from "@/lib/i18n/format";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { useCategories } from "@/components/app/categories";
import { useSave } from "./use-save";

export type Price = { id: string; code: string; name: string; category: string; unitPriceCents: number; currency: string; active: boolean };

/** Settings → Price list: the items quotes are built from. */
export function PriceListSettings({ prices, currency }: { prices: Price[]; currency: string }) {
  const { d, locale } = useI18n();
  const categories = useCategories();
  const { busy, call } = useSave();
  const [price, setPrice] = useState({ code: "", name: "", category: "other", price: "", currency });
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <Field label={d.settingsPage.code} className="w-32">
            {(p) => <Input {...p} dir="ltr" value={price.code} onChange={(e) => setPrice({ ...price, code: e.target.value })} />}
          </Field>
          <Field label={d.settingsPage.itemName} className="min-w-48 flex-1">
            {(p) => <Input {...p} value={price.name} onChange={(e) => setPrice({ ...price, name: e.target.value })} />}
          </Field>
          <Field label={d.workspace.category}>
            {(p) => (
              <Select {...p} value={price.category} onChange={(e) => setPrice({ ...price, category: e.target.value })}>
                {categories.list.map((c) => (
                  <option key={c.key} value={c.key}>
                    {categories.label(c.key)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={`${d.settingsPage.price} (${price.currency})`} className="w-32">
            {(p) => <Input {...p} type="number" dir="ltr" min="0" step="0.01" value={price.price} onChange={(e) => setPrice({ ...price, price: e.target.value })} />}
          </Field>
          <Button
            loading={busy === "price"}
            disabled={!price.code.trim() || !price.name.trim() || !price.price}
            onClick={() =>
              call(
                "price",
                () =>
                  api("/api/admin/price-list", {
                    body: { code: price.code, name: price.name, category: price.category, unitPriceCents: Math.round(parseFloat(price.price) * 100), currency: price.currency },
                  }),
                () => setPrice({ ...price, code: "", name: "", price: "" }),
              )
            }
          >
            <Plus className="size-4" /> {d.settingsPage.newPriceItem}
          </Button>
        </CardContent>
      </Card>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3 text-start font-medium">{d.admin.col.code}</th>
              <th className="px-4 py-3 text-start font-medium">{d.settingsPage.itemName}</th>
              <th className="px-4 py-3 text-start font-medium">{d.workspace.category}</th>
              <th className="px-4 py-3 text-end font-medium">{d.admin.col.price}</th>
              <th className="px-4 py-3 text-start font-medium">{d.common.status}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {prices.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-mono text-xs" dir="ltr">
                  {p.code}
                </td>
                <td className="bidi-auto px-4 py-3">{p.name}</td>
                <td className="px-4 py-3 text-slate-600">{categories.label(p.category)}</td>
                <td className="px-4 py-3 text-end tabular-nums">{formatMoney(p.unitPriceCents, p.currency, locale)}</td>
                <td className="px-4 py-3">
                  <Checkbox
                    label={p.active ? d.settingsPage.active : d.settingsPage.inactive}
                    checked={p.active}
                    onChange={(e) =>
                      call(p.id, () =>
                        api(`/api/admin/price-list/${p.id}`, {
                          method: "PATCH",
                          body: { code: p.code, name: p.name, category: p.category, unitPriceCents: p.unitPriceCents, currency: p.currency, active: e.target.checked },
                        }),
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
