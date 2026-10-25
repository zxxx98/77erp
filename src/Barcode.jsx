import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import React, { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export function Barcode({ value, height = 45 }) {
  useLocale();
  const ref = useRef();
  useEffect(() => {
    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        height,
        width: 1.5,
        margin: 8,
        fontSize: 12,
        font: "monospace",
        background: "#ffffff",
        lineColor: "#17243c",
      });
    } catch {}
  }, [value, height]);
  return <svg ref={ref} className="barcode" aria-label={translate("extra.barcode", { v0: value })} />;
}
