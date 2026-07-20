"use client";

import { useState } from "react";
import { SelectMenu } from "./SelectMenu";
import { useControlProps, baseCls, okCls, errCls, sizeCls, type ControlSize } from "./field-base";
import {
  COUNTRY_DIAL_OPTIONS, DEFAULT_DIAL_ISO, dialFor, nationalLengthOk, splitE164, toE164,
} from "@/lib/countries";

/**
 * Country-code picker + national number (issue 4.3), on EVERY phone field it's dropped into. The
 * picker limits the digit count per country (India 10, Germany 10–11, …) and prepends the correct
 * "+CC", which is what fixes the wrong-country-code capture bug (1.4) at source: the operator can
 * no longer submit "9876543210" with no country and have it guessed against +91.
 *
 * A single hidden <input name={name}> carries the combined E.164 value ("+919876543210"), so this
 * is a drop-in replacement for `<TextInput kind="phone" name="phone">` — every form + server action
 * still receives one `phone` string, and lib/phone.ts remains the authoritative validator.
 */
export function PhoneField({
  name,
  defaultValue = "",
  defaultCountry = DEFAULT_DIAL_ISO,
  required,
  size = "md",
  id,
}: {
  name: string;
  defaultValue?: string;
  defaultCountry?: string;
  required?: boolean;
  size?: ControlSize;
  id?: string;
}) {
  const initial = defaultValue ? splitE164(defaultValue) : { iso: defaultCountry, national: "" };
  const { invalid, "aria-describedby": describedBy } = useControlProps();
  const [iso, setIso] = useState(initial.iso);
  const [national, setNational] = useState(initial.national);

  const country = dialFor(iso);
  const combined = toE164(iso, national);
  // Soft, non-blocking length hint — the server (lib/phone.ts, libphonenumber) is the real gate.
  const lengthBad = national.trim().length > 0 && !nationalLengthOk(iso, national);
  const inputCls = `${baseCls} ${invalid || lengthBad ? errCls : okCls} ${sizeCls[size]}`;

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <div className="w-40 flex-none">
          <SelectMenu
            aria-label="Country code"
            options={COUNTRY_DIAL_OPTIONS}
            value={iso}
            onChange={(e) => setIso(e.currentTarget.value)}
            size={size}
          />
        </div>
        <span className="relative block min-w-0 flex-1">
          {/* The value every form/action reads: a single normalized phone string. */}
          <input type="hidden" name={name} value={combined} />
          <input
            id={id}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            // Room for the country's max digits plus a couple of grouping spaces.
            maxLength={country.max + 4}
            required={required}
            aria-required={required || undefined}
            aria-invalid={invalid || lengthBad || undefined}
            aria-describedby={describedBy}
            placeholder={country.example}
            value={national}
            onChange={(e) => setNational(e.currentTarget.value.replace(/[^\d\s]/g, ""))}
            className={inputCls}
          />
        </span>
      </div>
      {lengthBad && (
        <p className="text-caption text-bad">
          {country.name} numbers are {country.min === country.max ? country.min : `${country.min}–${country.max}`} digits.
        </p>
      )}
    </div>
  );
}
