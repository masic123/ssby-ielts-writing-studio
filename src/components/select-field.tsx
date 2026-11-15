"use client";
import * as Select from "@radix-ui/react-select";
import { CaretDown, CaretUp, Check } from "@phosphor-icons/react";

export type SelectOption = { value: string; label: string; meta?: string };
const emptyValue = "__empty__";

export default function SelectField({ id, label, value, onChange, options, disabled = false, describedBy }: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <Select.Root value={value || emptyValue} onValueChange={(next) => onChange(next === emptyValue ? "" : next)} disabled={disabled}>
      <Select.Trigger id={id} className="select-trigger" aria-label={label} aria-describedby={describedBy}>
        <Select.Value />
        <Select.Icon className="select-caret"><CaretDown size={15} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="select-menu" position="popper" align="start" sideOffset={7} collisionPadding={12}>
          <Select.ScrollUpButton className="select-scroll"><CaretUp size={15} /></Select.ScrollUpButton>
          <Select.Viewport className="select-viewport">
            <Select.Group>
              <Select.Label className="select-label">{label}</Select.Label>
              {options.map((option) => (
                <Select.Item className="select-option" key={option.value} value={option.value || emptyValue} textValue={option.label}>
                  <Select.ItemText>{option.label}</Select.ItemText>
                  {option.meta && <span className="select-meta">{option.meta}</span>}
                  <Select.ItemIndicator className="select-check"><Check size={15} weight="bold" /></Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Group>
          </Select.Viewport>
          <Select.ScrollDownButton className="select-scroll"><CaretDown size={15} /></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
