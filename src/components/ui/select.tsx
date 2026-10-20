import * as React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import './select.css';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  group?: string;
  disabled?: boolean;
  hidden?: boolean;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size' | 'onFocus' | 'onBlur' | 'onKeyDown' | 'onClick'>,
  Pick<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onFocus' | 'onBlur' | 'onKeyDown' | 'onClick'> {
  options?: readonly SelectOption[];
  onValueChange?(value: string): void;
  placeholder?: string;
  emptyText?: string;
  icon?: React.ReactNode;
  caption?: string;
  showGroup?: boolean;
  placement?: 'auto' | 'top' | 'bottom';
  variant?: 'default' | 'compact';
  triggerRef?: React.Ref<HTMLButtonElement>;
}

function nodeText(node: React.ReactNode): string {
  return React.Children.toArray(node).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return React.isValidElement<{ children?: React.ReactNode }>(child) ? nodeText(child.props.children) : '';
  }).join('');
}

function childOptions(children: React.ReactNode, group?: string, disabled = false): SelectOption[] {
  return React.Children.toArray(children).flatMap(child => {
    if (!React.isValidElement<React.OptionHTMLAttributes<HTMLOptionElement> & { children?: React.ReactNode }>(child)) return [];
    if (child.type === 'option') return [{ value: String(child.props.value ?? nodeText(child.props.children)), label: child.props.label ?? nodeText(child.props.children), group, disabled: disabled || child.props.disabled, hidden: child.props.hidden }];
    if (child.type === 'optgroup') return childOptions(child.props.children, child.props.label, disabled || child.props.disabled);
    if (child.type === React.Fragment) return childOptions(child.props.children, group, disabled);
    return [];
  });
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select({
  className, options: suppliedOptions, children, value, defaultValue, onChange, onValueChange,
  placeholder = '请选择', emptyText = '暂无可选项', icon, caption, showGroup = false,
  placement = 'auto', variant = 'default', triggerRef: forwardedTriggerRef,
  disabled, id: suppliedId, title, onFocus, onBlur, onKeyDown, onClick, autoFocus,
  'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, 'aria-describedby': ariaDescribedBy,
  tabIndex, style, ...nativeProps
}, forwardedRef) {
  const generatedId = React.useId();
  const id = suppliedId ?? generatedId;
  const nativeRef = React.useRef<HTMLSelectElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const popupRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef({ text: '', time: 0 });
  const [internalValue, setInternalValue] = React.useState(String(defaultValue ?? ''));
  const [open, setOpen] = React.useState(false);
  const [invalid, setInvalid] = React.useState(false);
  const [activeValue, setActiveValue] = React.useState<string>();
  const [inferredLabel, setInferredLabel] = React.useState<string>();
  const [position, setPosition] = React.useState<React.CSSProperties>({ visibility: 'hidden' });
  const [portalHost, setPortalHost] = React.useState<HTMLElement>();
  const options = React.useMemo(() => suppliedOptions ?? childOptions(children), [suppliedOptions, children]);
  const visibleOptions = options.filter(option => !option.hidden);
  const enabledOptions = visibleOptions.filter(option => !option.disabled);
  const currentValue = value === undefined ? internalValue : String(value);
  const selected = options.find(option => option.value === currentValue);
  const activeOption = visibleOptions.find(option => option.value === activeValue && !option.disabled);
  const expanded = open && !disabled;

  React.useImperativeHandle(forwardedRef, () => nativeRef.current!, []);
  React.useImperativeHandle(forwardedTriggerRef, () => triggerRef.current!, []);

  React.useLayoutEffect(() => {
    if (value === undefined && nativeRef.current) setInternalValue(nativeRef.current.value);
  }, [value, options]);

  React.useEffect(() => {
    const form = nativeRef.current?.form;
    if (!form || value !== undefined) return;
    const reset = () => queueMicrotask(() => {
      if (nativeRef.current) setInternalValue(nativeRef.current.value);
      setInvalid(false);
      setOpen(false);
    });
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [value, nativeProps.form]);

  React.useLayoutEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger || ariaLabel || ariaLabelledBy) return;
    const previous = trigger.previousElementSibling;
    const label = trigger.closest('label') ?? (previous instanceof HTMLLabelElement ? previous : null);
    if (!label) return;
    if (!label.id) label.id = `${id}-label`;
    setInferredLabel(label.id);
  }, [id, ariaLabel, ariaLabelledBy]);

  React.useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  React.useEffect(() => {
    if (nativeRef.current?.validity.valid) setInvalid(false);
  }, [currentValue, options, nativeProps.required]);

  React.useLayoutEffect(() => {
    if (!expanded) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    setPortalHost(trigger.closest<HTMLElement>('dialog, [role=dialog]') ?? (document.fullscreenElement as HTMLElement | null) ?? document.body);
    const update = () => {
      const rect = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const above = rect.top - viewportTop - 16;
      const below = viewportBottom - rect.bottom - 16;
      const preferredTop = placement === 'top' || (placement === 'auto' && below < 260 && above > below);
      const top = preferredTop ? above >= Math.min(160, below) : below < Math.min(160, above);
      const width = Math.min(Math.max(rect.width, 220), viewportWidth - 16);
      setPosition({ position: 'fixed', left: Math.max(viewportLeft + 8, Math.min(rect.left, viewportLeft + viewportWidth - width - 8)), width, maxHeight: Math.max(0, Math.min(336, top ? above : below)), ...(top ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(trigger);
    const scroll = (event: Event) => { if (!popupRef.current?.contains(event.target as Node)) update(); };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', scroll, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', scroll, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [expanded, placement]);

  React.useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !popupRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [expanded]);

  React.useLayoutEffect(() => {
    if (!expanded || !portalHost) return;
    const popup = popupRef.current;
    if (popup?.showPopover && !popup.matches(':popover-open')) popup.showPopover();
    popup?.querySelector<HTMLElement>('[data-active=true]')?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded, activeValue, portalHost]);

  function show(edge?: 'first' | 'last') {
    if (disabled || triggerRef.current?.matches(':disabled')) return;
    setActiveValue((edge === 'first' ? enabledOptions[0] : edge === 'last' ? enabledOptions[enabledOptions.length - 1] : enabledOptions.find(option => option.value === selected?.value) ?? enabledOptions[0])?.value);
    searchRef.current = { text: '', time: 0 };
    setOpen(true);
  }

  function choose(option: SelectOption) {
    if (option.disabled || disabled || triggerRef.current?.matches(':disabled')) return;
    setOpen(false);
    triggerRef.current?.focus();
    const native = nativeRef.current;
    if (!native || (selected && native.value === option.value)) return;
    native.value = option.value;
    native.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function keydown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && expanded) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); return;
    }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (!expanded) { show(event.key === 'Home' ? 'first' : event.key === 'End' ? 'last' : undefined); return; }
      const index = enabledOptions.findIndex(option => option.value === activeValue);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabledOptions.length - 1 : Math.max(0, Math.min(enabledOptions.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      setActiveValue(enabledOptions[next]?.value);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation();
      if (!expanded) show();
      else if (activeOption) choose(activeOption);
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing) return;
    const now = Date.now();
    const text = (now - searchRef.current.time < 700 ? searchRef.current.text : '') + event.key.toLocaleLowerCase();
    searchRef.current = { text, time: now };
    const prefix = [...text].every(character => character === text[0]) ? text[0] : text;
    const start = enabledOptions.findIndex(option => option.value === (expanded ? activeValue : selected?.value));
    const offset = enabledOptions.findIndex((_, index) => enabledOptions[(start + 1 + index) % enabledOptions.length].label.toLocaleLowerCase().startsWith(prefix));
    if (offset < 0) return;
    event.preventDefault();
    setActiveValue(enabledOptions[(start + 1 + offset) % enabledOptions.length].value);
    setOpen(true);
  }

  return <>
    <button ref={triggerRef} id={id} type="button" role="combobox" className={cn('ui-select-trigger inline-flex h-9 w-full min-w-0 items-center gap-2 px-3 py-1 text-sm text-foreground', variant === 'compact' && 'h-8 px-2 text-xs', className)} style={style} value={selected?.value ?? ''} disabled={disabled} autoFocus={autoFocus} tabIndex={tabIndex} title={title ?? selected?.label} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy ?? inferredLabel} aria-describedby={ariaDescribedBy} aria-required={nativeProps.required || undefined} aria-invalid={nativeProps['aria-invalid'] ?? (invalid || undefined)} aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? `${id}-list` : undefined} aria-activedescendant={expanded && activeOption ? `${id}-option-${visibleOptions.indexOf(activeOption)}` : undefined} onFocus={onFocus} onClick={event => { onClick?.(event); if (!event.defaultPrevented) { if (expanded) setOpen(false); else show(); } }} onKeyDown={event => { onKeyDown?.(event); if (!event.defaultPrevented) keydown(event); }} onBlur={event => { setOpen(false); onBlur?.(event); }}>
      {icon && <span className="ui-select-icon" aria-hidden="true">{icon}</span>}
      <span className="ui-select-value">{showGroup && selected?.group && <span className="ui-select-group-value">{selected.group}</span>}<span className={selected ? undefined : 'ui-select-placeholder'}>{selected?.label ?? placeholder}</span></span>
      <ChevronDown size={14} className="ui-select-chevron" aria-hidden="true" />
    </button>
    <select {...nativeProps} ref={nativeRef} id={`${id}-native`} hidden aria-hidden="true" tabIndex={-1} disabled={disabled} value={value} defaultValue={defaultValue} onInvalid={event => { event.preventDefault(); setInvalid(true); triggerRef.current?.focus(); nativeProps.onInvalid?.(event); }} onChange={event => { setInvalid(!event.target.validity.valid); setInternalValue(event.target.value); onChange?.(event); onValueChange?.(event.target.value); }}>
      {suppliedOptions ? options.map(option => <option key={option.value} value={option.value} disabled={option.disabled} hidden={option.hidden}>{option.label}</option>) : children}
    </select>
    {expanded && portalHost && createPortal(<div ref={popupRef} popover={typeof HTMLElement.prototype.showPopover === 'function' ? 'manual' : undefined} className="ui-select-popover" style={position} onPointerDown={event => event.preventDefault()} onMouseDown={event => event.stopPropagation()}>
      {caption && <div className="ui-select-caption">{caption}</div>}
      <div id={`${id}-list`} role="listbox" aria-label={ariaLabel ?? caption} aria-labelledby={!ariaLabel && !caption ? ariaLabelledBy ?? inferredLabel ?? id : undefined} className="ui-select-list">
        {visibleOptions.length ? visibleOptions.map((option, index) => <React.Fragment key={option.value}>
          {option.group && option.group !== visibleOptions[index - 1]?.group && <div className="ui-select-group" role="presentation">{option.group}</div>}
          <div id={`${id}-option-${index}`} role="option" aria-label={option.label} aria-selected={option.value === selected?.value} aria-disabled={option.disabled || undefined} data-active={option.value === activeValue && !option.disabled} className="ui-select-option" onPointerMove={() => { if (!option.disabled) setActiveValue(option.value); }} onClick={event => { event.preventDefault(); event.stopPropagation(); choose(option); }} title={option.description ? `${option.label} · ${option.description}` : option.label}>
            <span className="ui-select-option-text"><span>{option.label}</span>{option.description && <small>{option.description}</small>}</span>
            {option.value === selected?.value && <Check size={15} aria-hidden="true" />}
          </div>
        </React.Fragment>) : <div className="ui-select-empty" role="status">{emptyText}</div>}
      </div>
    </div>, portalHost)}
  </>;
});

export { Select };
