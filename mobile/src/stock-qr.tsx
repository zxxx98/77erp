import React, { useEffect, useRef, useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { BarcodeFormat, EncodeHintType, QRCodeWriter } from "@zxing/library";
import { api, ApiError, device, scanBarcode } from "./native";
import { Product, Workspace, money } from "./model";
import { resolveProductCode } from "./product-scan";
import { Button, Card, Chips, Field, ScreenModal, s, useFormError } from "./ui";

type Item = {
  product_id: number;
  name: string;
  barcode: string;
  unit: string;
  stock: number;
  quantity: number;
  price_cents: number;
  amount_cents: number;
};
export type StockQr = {
  id: number;
  qr_id: string;
  warehouse_id: number;
  warehouse_name: string;
  name: string;
  type: "in" | "out";
  items: Item[];
  max_scans: number | null;
  used_scans: number;
  remaining_scans: number | null;
  require_confirmation: boolean;
  enabled: boolean;
  partner_id: number;
  partner_name: string;
  note: string;
  version: number;
};
type Preview = StockQr & {
  preview_token: string;
  expires_at: string;
  total_cents: number;
};
type Result = {
  id: number;
  number: string;
  items: Item[];
  remaining_scans: number | null;
};
type Pending = {
  qr_id: string;
  preview: Preview;
  body: { preview_token: string; confirmed: boolean; request_id: string };
};
type Form = {
  name: string;
  type: "in" | "out";
  items: (Omit<Item, "quantity"> & { quantity: string; price: string })[];
  max_scans: string | null;
  require_confirmation: boolean;
  enabled: boolean;
  partner: string;
  partner_id?: number;
  note: string;
};
const requestId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
export function stockQrLabel(raw: string): object | null {
  try {
    const v = JSON.parse(raw);
    return v?.format === "77erp" && v.type === "stock_operation" ? v : null;
  } catch {
    return null;
  }
}
function Lines({ items }: { items: Item[] }) {
  return (
    <>
      {items.map((i) => (
        <Card key={i.product_id}>
          <Text style={s.subtitle}>{i.name}</Text>
          <Text style={s.caption}>
            {i.barcode} · 库存 {i.stock} {i.unit}
          </Text>
          <Text>
            {i.quantity} {i.unit} × {money(i.price_cents / 100)} ·{" "}
            {money((i.quantity * i.price_cents) / 100)}
          </Text>
        </Card>
      ))}
    </>
  );
}
function Symbol({ qr, sourceId }: { qr: StockQr; sourceId?: string }) {
  const [symbol, setSymbol] = useState<{ size: number; path: string }>();
  useEffect(() => {
    const payload = JSON.stringify({
      format: "77erp",
      version: 1,
      type: "stock_operation",
      source_id: sourceId,
      warehouse_id: qr.warehouse_id,
      qr_id: qr.qr_id,
    });
    const hints = new Map<EncodeHintType, unknown>([
      [EncodeHintType.CHARACTER_SET, "UTF-8"],
      [EncodeHintType.ERROR_CORRECTION, "M"],
      [EncodeHintType.MARGIN, 4],
    ]);
    const m = new QRCodeWriter().encode(
      payload,
      BarcodeFormat.QR_CODE,
      0,
      0,
      hints,
    );
    const paths: string[] = [];
    for (let y = 0; y < m.getHeight(); y++)
      for (let x = 0; x < m.getWidth(); x++)
        if (m.get(x, y)) {
          const start = x;
          while (x + 1 < m.getWidth() && m.get(x + 1, y)) x++;
          paths.push(`M${start} ${y}h${x - start + 1}v1H${start}z`);
        }
    setSymbol({ size: m.getWidth(), path: paths.join("") });
  }, [qr, sourceId]);
  return symbol ? (
    <View
      accessible
      accessibilityLabel="出入库二维码"
      style={{ alignItems: "center" }}
    >
      <Svg
        width={256}
        height={256}
        viewBox={`0 0 ${symbol.size} ${symbol.size}`}
      >
        <Rect width={symbol.size} height={symbol.size} fill="white" />
        <Path d={symbol.path} fill="black" />
      </Svg>
    </View>
  ) : null;
}
export function StockQrManager({
  data,
  initialProduct,
  onClose,
}: {
  data: Workspace;
  initialProduct?: Product;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<StockQr[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [type, setType] = useState(""),
    [status, setStatus] = useState("");
  const [selected, setSelected] = useState<StockQr>(),
    [form, setForm] = useState<Form>(),
    [query, setQuery] = useState(""),
    [barcode, setBarcode] = useState("");
  const [records, setRecords] = useState<{
    rows: {
      id: number;
      version?: number;
      created_by_name: string;
      created_at: string;
      snapshot: StockQr;
      order?: { number: string; status: string };
    }[];
    total: number;
  }>();
  const [recordPage, setRecordPage] = useState(1),
    [recordKind, setRecordKind] = useState("usages");
  const [busy, setBusy] = useState(false);
  const { error, errorRevision, setError } = useFormError();
  const lock = useRef(false),
    request = useRef({ key: "", id: "" });
  const path = `/stock-qrs?page=${page}&type=${type}&status=${status}${initialProduct ? `&product_id=${initialProduct.id}` : ""}`;
  const load = async () => {
    const r = await api<{ rows: StockQr[]; total: number }>(path);
    setRows(r.rows);
    setTotal(r.total);
  };
  useEffect(() => {
    let live = true;
    api<{ rows: StockQr[]; total: number }>(path)
      .then((r) => {
        if (live) {
          setRows(r.rows);
          setTotal(r.total);
        }
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [path, setError]);
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  const send = async <T,>(url: string, method: string, body: object) => {
    const key = JSON.stringify([url, method, body]);
    if (request.current.key !== key) request.current = { key, id: requestId() };
    return api<T>(url, method, { ...body, request_id: request.current.id });
  };
  const line = (p: Product, t: "in" | "out") => ({
    product_id: p.id,
    name: p.name,
    barcode: p.barcode,
    unit: p.unit,
    stock: p.stock,
    quantity: "1",
    price: String(t === "in" ? p.cost : p.price),
    price_cents: Math.round((t === "in" ? p.cost : p.price) * 100),
    amount_cents: 0,
  });
  const edit = (q?: StockQr) => {
    setSelected(q);
    setRecords(undefined);
    setError("");
    setForm(
      q
        ? {
            name: q.name,
            type: q.type,
            partner: q.partner_name,
            partner_id: q.partner_id,
            note: q.note,
            max_scans: q.max_scans === null ? null : String(q.max_scans),
            require_confirmation: q.require_confirmation,
            enabled: q.enabled,
            items: q.items.map((i) => ({
              ...i,
              quantity: String(i.quantity),
              price: String(i.price_cents / 100),
            })),
          }
        : {
            name: initialProduct ? `${initialProduct.name}入库` : "入库二维码",
            type: "in",
            partner: "",
            note: "",
            max_scans: "1",
            require_confirmation: true,
            enabled: true,
            items: initialProduct ? [line(initialProduct, "in")] : [],
          },
    );
  };
  const add = (p: Product) => {
    if (!form) return;
    if (form.items.some((i) => i.product_id === p.id)) {
      setError("该商品已在明细中，请编辑已有数量。");
      return;
    }
    if (form.items.length >= 100) {
      setError("最多配置 100 种商品。");
      return;
    }
    setForm({ ...form, items: [...form.items, line(p, form.type)] });
    setQuery("");
    setError("");
  };
  const lookup = (raw: string) => {
    const p = resolveProductCode(raw, {
      products: data.products,
      warehouseId: data.warehouse_id,
      sourceId: data.instance_id,
    });
    if (!p) throw new Error("未找到商品，请先建立商品档案。");
    add(p);
    setBarcode("");
  };
  const save = () =>
    void run(async () => {
      if (!form) return;
      if (
        form.items.some(
          (i) =>
            !i.price.trim() ||
            !Number.isFinite(Number(i.price)) ||
            Math.abs(
              Number(i.price) * 100 - Math.round(Number(i.price) * 100),
            ) > 0.00001,
        )
      )
        throw new Error("各商品成交单价最多两位小数。");
      const q = await send<StockQr>(
        selected ? `/stock-qrs/${selected.qr_id}` : "/stock-qrs",
        selected ? "PUT" : "POST",
        {
          ...form,
          max_scans: form.max_scans === null ? null : Number(form.max_scans),
          items: form.items.map((i) => ({
            product_id: i.product_id,
            quantity: Number(i.quantity),
            price_cents: Math.round(Number(i.price) * 100),
          })),
          ...(selected ? { version: selected.version } : {}),
        },
      );
      setSelected(q);
      setForm(undefined);
      await load();
    });
  const recordLoad = (q: StockQr, kind: string, n = 1) =>
    void run(async () => {
      const r = await api<NonNullable<typeof records>>(
        `/stock-qrs/${q.qr_id}/${kind}?page=${n}`,
      );
      setSelected(q);
      setForm(undefined);
      setRecords(r);
      setRecordPage(n);
      setRecordKind(kind);
    });
  const back = () => {
    setSelected(undefined);
    setForm(undefined);
    setRecords(undefined);
    setError("");
  };
  return (
    <ScreenModal
      title={
        form
          ? "编辑出入库二维码"
          : records
            ? "二维码记录"
            : selected
              ? "出入库二维码标签"
              : "管理出入库二维码"
      }
      onClose={onClose}
      busy={busy}
      error={error}
      errorRevision={errorRevision}
    >
      {(selected || form) && (
        <Button
          title="返回列表"
          kind="secondary"
          disabled={busy}
          onPress={back}
        />
      )}
      {form ? (
        <>
          <Field
            label="二维码名称"
            value={form.name}
            maxLength={60}
            editable={!busy}
            onChangeText={(name) => setForm({ ...form, name })}
          />
          {!selected && (
            <Chips
              value={form.type}
              onChange={(value) => {
                const t = value as "in" | "out";
                setForm({
                  ...form,
                  type: t,
                  partner: t === "out" ? "零售客户" : "",
                  partner_id: undefined,
                  items: form.items.map((i) => {
                    const p = data.products.find((p) => p.id === i.product_id);
                    return {
                      ...i,
                      price: String(
                        t === "in" ? (p?.cost ?? 0) : (p?.price ?? 0),
                      ),
                    };
                  }),
                });
              }}
              options={[
                { id: "in", label: "入库" },
                { id: "out", label: "出库" },
              ]}
            />
          )}
          <Text style={s.subtitle}>商品明细（{form.items.length}/100）</Text>
          <Field
            label="搜索添加商品"
            value={query}
            onChangeText={setQuery}
            editable={!busy}
          />
          {query &&
            data.products
              .filter((p) =>
                `${p.name} ${p.barcode}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .slice(0, 10)
              .map((p) => (
                <Button
                  key={p.id}
                  title={`添加 ${p.name} · ${p.barcode}`}
                  kind="secondary"
                  disabled={busy}
                  onPress={() => add(p)}
                />
              ))}
          <Button
            title="扫描添加商品"
            kind="secondary"
            busy={busy}
            onPress={() =>
              void run(async () => {
                const raw = await scanBarcode();
                if (raw) lookup(raw);
              })
            }
          />
          <Field
            label="添加商品条码"
            value={barcode}
            onChangeText={setBarcode}
            editable={!busy}
          />
          <Button
            title="识别商品"
            kind="secondary"
            disabled={busy || !barcode}
            onPress={() => void run(async () => lookup(barcode))}
          />
          {form.items.map((i, index) => (
            <Card key={i.product_id}>
              <Text style={s.subtitle}>{i.name}</Text>
              <Text style={s.caption}>
                {i.barcode} · 库存 {i.stock} {i.unit}
              </Text>
              <Field
                label={`${i.name} 单次数量（${i.unit}）`}
                keyboardType="number-pad"
                value={i.quantity}
                editable={!busy}
                onChangeText={(quantity) =>
                  setForm({
                    ...form,
                    items: form.items.map((j) =>
                      j.product_id === i.product_id ? { ...j, quantity } : j,
                    ),
                  })
                }
              />
              <Field
                label={`${i.name} 成交单价`}
                keyboardType="decimal-pad"
                value={i.price}
                editable={!busy}
                onChangeText={(price) =>
                  setForm({
                    ...form,
                    items: form.items.map((j) =>
                      j.product_id === i.product_id ? { ...j, price } : j,
                    ),
                  })
                }
              />
              <Text>金额 {money(Number(i.quantity) * Number(i.price))}</Text>
              {form.type === "out" && Number(i.quantity) > i.stock && (
                <Text style={s.errorText}>
                  当前库存不足，暂时无法整组执行。
                </Text>
              )}
              <Button
                title={`上移 ${i.name}`}
                kind="secondary"
                disabled={busy || !index}
                onPress={() => {
                  const items = [...form.items];
                  const a = items[index - 1],
                    b = items[index];
                  if (a && b) {
                    items[index - 1] = b;
                    items[index] = a;
                    setForm({ ...form, items });
                  }
                }}
              />
              <Button
                title={`移除 ${i.name}`}
                kind="secondary"
                disabled={busy}
                onPress={() =>
                  setForm({
                    ...form,
                    items: form.items.filter(
                      (j) => j.product_id !== i.product_id,
                    ),
                  })
                }
              />
            </Card>
          ))}
          <Text>
            单次总金额：
            {money(
              form.items.reduce(
                (sum, i) =>
                  sum + Math.round(Number(i.quantity) * Number(i.price) * 100),
                0,
              ) / 100,
            )}
          </Text>
          {selected && (
            <Text>已用 {selected.used_scans} 次，修改组合不清零。</Text>
          )}
          <Text>不限次数</Text>
          <Switch
            accessibilityLabel="不限次数"
            value={form.max_scans === null}
            disabled={busy}
            onValueChange={(unlimited) =>
              setForm({
                ...form,
                max_scans: unlimited
                  ? null
                  : String(Math.max(selected?.used_scans || 0, 1)),
              })
            }
          />
          {form.max_scans !== null && (
            <Field
              label="可扫描次数（累计上限）"
              keyboardType="number-pad"
              value={form.max_scans}
              editable={!busy}
              onChangeText={(max_scans) => setForm({ ...form, max_scans })}
            />
          )}
          <Text>需要二次确认</Text>
          <Switch
            accessibilityLabel="需要二次确认"
            value={form.require_confirmation}
            disabled={busy}
            onValueChange={(require_confirmation) =>
              setForm({ ...form, require_confirmation })
            }
          />
          {!form.require_confirmation && (
            <Text style={s.caption}>
              扫码后将直接生成整张单据并更新全部商品库存。
            </Text>
          )}
          <Field
            label="往来单位"
            value={form.partner}
            editable={!busy}
            maxLength={100}
            onChangeText={(partner) => {
              const c = data.contacts?.find(
                (c) =>
                  c.name === partner &&
                  c.active &&
                  c.role === (form.type === "in" ? "supplier" : "customer"),
              );
              setForm({ ...form, partner, partner_id: c?.id });
            }}
          />
          {(data.contacts || [])
            .filter(
              (c) =>
                c.active &&
                c.role === (form.type === "in" ? "supplier" : "customer"),
            )
            .slice(0, 10)
            .map((c) => (
              <Button
                key={c.id}
                title={`选择 ${c.name}`}
                kind="secondary"
                disabled={busy}
                onPress={() =>
                  setForm({ ...form, partner: c.name, partner_id: c.id })
                }
              />
            ))}
          <Field
            label="单据备注"
            value={form.note}
            editable={!busy}
            maxLength={500}
            onChangeText={(note) => setForm({ ...form, note })}
          />
          <Text>启用</Text>
          <Switch
            accessibilityLabel="启用二维码"
            value={form.enabled}
            disabled={busy}
            onValueChange={(enabled) => setForm({ ...form, enabled })}
          />
          <Button
            title="保存二维码"
            busy={busy}
            onPress={() =>
              selected
                ? Alert.alert(
                    "保存配置",
                    "已打印的二维码将按新的商品明细和配置执行。",
                    [
                      { text: "取消", style: "cancel" },
                      { text: "保存", onPress: save },
                    ],
                  )
                : save()
            }
          />
        </>
      ) : records ? (
        <>
          {!records.rows.length && <Text>暂无记录。</Text>}
          {records.rows.map((r) => (
            <Card key={r.id}>
              <Text>
                {r.order
                  ? `${r.order.number} · ${r.order.status === "void" ? "已作废" : "有效"}`
                  : `配置版本 ${r.version}`}
              </Text>
              <Text style={s.caption}>
                {r.created_by_name || "操作人未知"} · {r.created_at}
              </Text>
              <Lines items={r.snapshot.items} />
            </Card>
          ))}
          <Button
            title="上一页记录"
            kind="secondary"
            disabled={busy || recordPage === 1}
            onPress={() =>
              selected && recordLoad(selected, recordKind, recordPage - 1)
            }
          />
          <Text>
            第 {recordPage} 页 · 共 {records.total} 条
          </Text>
          <Button
            title="下一页记录"
            kind="secondary"
            disabled={busy || recordPage * 20 >= records.total}
            onPress={() =>
              selected && recordLoad(selected, recordKind, recordPage + 1)
            }
          />
        </>
      ) : selected ? (
        <>
          <Text style={s.subtitle}>{selected.name}</Text>
          <Text>
            {selected.warehouse_name} ·{" "}
            {selected.type === "in" ? "入库" : "出库"} ·{" "}
            {selected.require_confirmation ? "需要二次确认" : "免确认"}
          </Text>
          <Symbol qr={selected} sourceId={data.instance_id} />
          <Text style={s.caption}>以系统当前配置为准</Text>
          <Lines items={selected.items} />
          <Button
            title="编辑配置"
            disabled={busy}
            onPress={() => edit(selected)}
          />
          <Button
            title="查看使用记录"
            kind="secondary"
            disabled={busy}
            onPress={() => recordLoad(selected, "usages")}
          />
          <Button
            title="查看修改记录"
            kind="secondary"
            disabled={busy}
            onPress={() => recordLoad(selected, "revisions")}
          />
        </>
      ) : (
        <>
          <Button title="新建二维码" onPress={() => edit()} />
          <Chips
            value={type}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
            options={[
              { id: "", label: "全部类型" },
              { id: "in", label: "入库" },
              { id: "out", label: "出库" },
            ]}
          />
          <Chips
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={[
              { id: "", label: "全部状态" },
              { id: "available", label: "可用" },
              { id: "exhausted", label: "已用完" },
              { id: "disabled", label: "已停用" },
            ]}
          />
          {!rows.length && (
            <Text>暂无出入库二维码，请新建并添加商品明细。</Text>
          )}
          {rows.map((q) => (
            <Card key={q.qr_id}>
              <Text style={s.subtitle}>{q.name}</Text>
              <Text>
                {q.type === "in" ? "入库" : "出库"} · {q.items.length} 种商品 ·
                已用 {q.used_scans}/{q.max_scans ?? "不限"} 次 ·{" "}
                {q.require_confirmation ? "需要确认" : "免确认"} ·{" "}
                {!q.enabled
                  ? "已停用"
                  : q.remaining_scans === 0
                    ? "已用完"
                    : "可用"}
              </Text>
              <Lines items={q.items} />
              <Button
                title={`查看标签 ${q.name}`}
                kind="secondary"
                onPress={() => setSelected(q)}
              />
              <Button
                title={`编辑 ${q.name}`}
                kind="secondary"
                onPress={() => edit(q)}
              />
              <Button
                title={q.enabled ? `停用 ${q.name}` : `启用 ${q.name}`}
                kind="secondary"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await send(`/stock-qrs/${q.qr_id}`, "PUT", {
                      ...q,
                      partner: q.partner_name,
                      enabled: !q.enabled,
                    });
                    await load();
                  })
                }
              />
            </Card>
          ))}
          <Button
            title="上一页"
            kind="secondary"
            disabled={page === 1}
            onPress={() => setPage(page - 1)}
          />
          <Text>
            第 {page} 页 · 共 {total} 条
          </Text>
          <Button
            title="下一页"
            kind="secondary"
            disabled={page * 20 >= total}
            onPress={() => setPage(page + 1)}
          />
        </>
      )}
    </ScreenModal>
  );
}

export function StockQrExecution({
  label,
  onLabelDone,
  mode,
  storageKey,
  warehouseId,
  onSaved,
  onBusy,
}: {
  label: object | null;
  onLabelDone: () => void;
  mode: string;
  storageKey: string;
  warehouseId: number;
  onSaved: (message: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [preview, setPreview] = useState<Preview>(),
    [pending, setPending] = useState<Pending>(),
    [result, setResult] = useState<Result>(),
    [busy, setBusy] = useState(false);
  const { error, errorRevision, setError } = useFormError();
  const lock = useRef(false),
    processed = useRef<object | null>(null);
  useEffect(() => {
    if (!device.getStockQrPending) return;
    let live = true;
    onBusy(true);
    device
      .getStockQrPending(storageKey)
      .then((raw) => {
        if (live && raw) setPending(JSON.parse(raw) as Pending);
      })
      .catch((e) => live && setError((e as Error).message))
      .finally(() => live && onBusy(false));
    return () => {
      live = false;
    };
  }, [storageKey]);
  const execute = async (task: Pending) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await device.setStockQrPending(storageKey, JSON.stringify(task));
      setPending(task);
      const r = await api<Result>(
        `/stock-qrs/${task.qr_id}/execute`,
        "POST",
        task.body,
        warehouseId,
      );
      setResult(r);
      setPreview(undefined);
      setPending(undefined);
      onLabelDone();
      await device.setStockQrPending(storageKey, null);
      onSaved(`单据 ${r.number} 已保存`);
    } catch (e) {
      setError((e as Error).message);
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        ![401, 403].includes(e.status)
      ) {
        setPreview(undefined);
        setPending(undefined);
        onLabelDone();
        await device.setStockQrPending(storageKey, null);
      }
    } finally {
      setBusy(false);
      onBusy(false);
      lock.current = false;
    }
  };
  const submit = (p: Preview) =>
    void execute({
      qr_id: p.qr_id,
      preview: p,
      body: {
        preview_token: p.preview_token,
        confirmed: p.require_confirmation,
        request_id: requestId(),
      },
    });
  useEffect(() => {
    if (!label || processed.current === label) return;
    processed.current = label;
    if (pending) {
      setError("上次扫码结果未知，请先重试原请求。");
      onLabelDone();
      return;
    }
    let live = true;
    onBusy(true);
    setBusy(true);
    setError("");
    setResult(undefined);
    api<Preview>("/stock-qrs/preview", "POST", { label, mode }, warehouseId)
      .then((p) => {
        if (live) {
          setPreview(p);
          setBusy(false);
          onBusy(false);
          if (!p.require_confirmation) submit(p);
        }
      })
      .catch((e) => {
        if (live) {
          setError((e as Error).message);
          onLabelDone();
        }
      })
      .finally(() => {
        if (live && !lock.current) {
          setBusy(false);
          onBusy(false);
        }
      });
    return () => {
      live = false;
    };
  }, [label]);
  const cancel = () => {
    if (!busy) {
      setPreview(undefined);
      onLabelDone();
    }
  };
  return (
    <>
      {error && (
        <Text accessibilityRole="alert" style={s.errorText}>
          {error}
        </Text>
      )}
      {pending && (
        <Card>
          <Text>上次扫码结果未知，请重试同一请求，避免重复出入库。</Text>
          <Button
            title="重试原扫码请求"
            busy={busy}
            onPress={() => void execute(pending)}
          />
        </Card>
      )}
      {result && (
        <Card>
          <Text style={s.subtitle}>单据 {result.number} 已保存</Text>
          <Lines items={result.items} />
          <Text>剩余次数：{result.remaining_scans ?? "不限"}</Text>
        </Card>
      )}
      {preview?.require_confirmation && !pending && (
        <ScreenModal
          title={preview.type === "in" ? "确认入库" : "确认出库"}
          onClose={cancel}
          busy={busy}
          error={error}
          errorRevision={errorRevision}
          footer={
            <Button
              title={preview.type === "in" ? "确认入库" : "确认出库"}
              busy={busy}
              onPress={() => submit(preview)}
            />
          }
        >
          {" "}
          <Text>
            {preview.warehouse_name} · {preview.name}
          </Text>
          <Lines items={preview.items} />
          <Text>
            总金额 {money(preview.total_cents / 100)} · 往来单位：
            {preview.partner_name}
          </Text>
          <Text>
            备注：{preview.note || "无"} · 剩余次数：
            {preview.remaining_scans ?? "不限"}
          </Text>
          <Button
            title="取消"
            kind="secondary"
            disabled={busy}
            onPress={cancel}
          />
        </ScreenModal>
      )}
    </>
  );
}
