function normalizeAddressPart(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function addDefaultLocality(address: string, locality?: string) {
  const trimmedAddress = address.trim();
  const trimmedLocality = locality?.trim();

  if (!trimmedAddress || !trimmedLocality) return trimmedAddress;

  const normalizedAddress = ` ${normalizeAddressPart(trimmedAddress)} `;
  const normalizedLocality = normalizeAddressPart(trimmedLocality);

  if (!normalizedLocality || normalizedAddress.includes(` ${normalizedLocality} `)) {
    return trimmedAddress;
  }

  return `${trimmedAddress}, ${trimmedLocality}`;
}
