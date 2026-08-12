export function publicProduct<T extends Record<string, any> | null | undefined>(product: T): T {
  if (!product) return product;
  return {
    ...product,
    id: product.publicId || product.hookId || product.id,
  };
}

export function publicOrder<T extends Record<string, any> | null | undefined>(order: T): T {
  if (!order) return order;
  return {
    ...order,
    id: order.publicId || order.orderCode || order.id,
    items: Array.isArray(order.items)
      ? order.items.map((item: Record<string, any>) => ({
          ...item,
          product: publicProduct(item.product),
          productId: item.product?.hookId || item.productId,
        }))
      : order.items,
  };
}

export function publicCart<T extends Record<string, any> | null | undefined>(cart: T): T {
  if (!cart) return cart;

  if (!Array.isArray(cart.items) && !Array.isArray(cart.stateGroups)) {
    return cart;
  }

  const lines = Array.isArray(cart.items)
    ? cart.items.map((item: Record<string, any>) => publicCartLine(item))
    : [];
  const lineById = new Map(
    lines.filter((item: Record<string, any>) => item.id).map((item: Record<string, any>) => [String(item.id), item]),
  );
  const stateGroups = Array.isArray(cart.stateGroups)
    ? cart.stateGroups.map((group: Record<string, any>) => {
        const groupLines = Array.isArray(group.items)
          ? group.items.map((item: Record<string, any>) => publicCartLine(item))
          : (group.itemIds || [])
              .map((id: unknown) => lineById.get(String(id)))
              .filter(Boolean);
        const lineIds = groupLines
          .map((item: Record<string, any>) => item.id)
          .filter(Boolean);
        const subtotalMinor = Number(group.subtotalMinor || 0);
        return {
          stateId:
            group.publicStateId ||
            group.state?.publicId ||
            (typeof group.stateId === "string" && !looksLikeMongoId(group.stateId)
              ? group.stateId
              : undefined),
          state: group.state
            ? {
                id: group.state.publicId,
                name: group.state.name,
                code: group.state.code,
              }
            : undefined,
          itemIds: lineIds,
          itemCount: groupLines.reduce(
            (total: number, item: Record<string, any>) => total + Number(item.quantity || 0),
            0,
          ),
          subtotalMinor,
          currency: group.currency || cart.currency || "NGN",
          checkoutEligible: group.checkoutEligible === true,
          blockingReasons: group.blockingReasons || [],
        };
      })
    : [];
  const subtotalMinor = Number(
    cart.subtotalMinor ??
      lines.reduce(
        (total: number, item: Record<string, any>) => total + Number(item.lineTotalMinor || 0),
        0,
      ),
  );
  const deliveryFeeMinor = Number(
    cart.deliveryFeeMinor ?? Math.round(Number(cart.deliveryFee || 0) * 100),
  );
  const totalMinor = Number(
    cart.totalMinor ?? subtotalMinor + deliveryFeeMinor,
  );

  return {
    id: publicIdentifier(cart.publicId || cart.id),
    publicId: publicIdentifier(cart.publicId || cart.id),
    version: cart.version,
    status: cart.status || "active",
    isCheckedOut: Boolean(cart.isCheckedOut),
    currency: cart.currency || "NGN",
    itemCount: lines.reduce(
      (total: number, item: Record<string, any>) => total + Number(item.quantity || 0),
      0,
    ),
    subtotalMinor,
    deliveryFeeMinor,
    totalMinor,
    items: lines,
    sourceStateCount: new Set(
      lines.map((item: Record<string, any>) => item.stateId).filter(Boolean),
    ).size,
  } as unknown as T;
}

function publicCartLine(item: Record<string, any>) {
  const product = item.product as Record<string, any> | undefined;
  const productId = product
    ? publicIdentifier(product.publicId || product.hookId || product.id)
    : typeof item.productId === "string" && !looksLikeMongoId(item.productId)
      ? item.productId
      : null;
  const lineId = publicIdentifier(item.publicId || item.id);
  const unitPriceMinor = Number(
    item.unitPriceMinor ?? Math.round(Number(item.unitPrice || 0) * 100),
  );
  const lineTotalMinor = Number(
    item.totalPriceMinor ?? Math.round(Number(item.totalPrice || 0) * 100),
  );
  const imageUrls = product ? productImageUrls(product) : [];

  return {
    id: lineId,
    productId,
    quantity: Number(item.quantity || 0),
    unitPriceMinor,
    totalPriceMinor: lineTotalMinor,
    currency: item.currency || product?.currency || "NGN",
    selectedVariants: item.selectedVariants || {},
    stateId:
      item.publicStateId ||
      (typeof item.stateId === "string" && !looksLikeMongoId(item.stateId)
        ? item.stateId
        : null),
    checkoutEligible: item.checkoutEligible === true,
    blockingReasons: item.blockingReasons || [],
    negotiatedQuote: item.negotiatedQuote
      ? {
          id: publicIdentifier(item.negotiatedQuote.id),
          originalPriceMinor: Number(item.negotiatedQuote.originalPriceMinor || 0),
          agreedPriceMinor: Number(item.negotiatedQuote.agreedPriceMinor || 0),
          expiresAt: item.negotiatedQuote.expiresAt,
          status: item.negotiatedQuote.status,
        }
      : undefined,
    product: product
      ? {
          id: productId,
          title: product.title,
          slug: product.slug,
          imageUrl: product.imageUrl || imageUrls[0] || null,
        }
      : undefined,
  };
}

function productImageUrls(product: Record<string, any>) {
  const values = [
    product.imageUrl,
    ...(Array.isArray(product.images) ? product.images : []),
    ...(Array.isArray(product.media) ? product.media : []),
  ];
  return values
    .map((value) => (typeof value === "string" ? value : value?.url))
    .filter((value): value is string => Boolean(value));
}

function looksLikeMongoId(value: string) {
  return /^[a-f\d]{24}$/i.test(value);
}

function publicIdentifier(value: unknown) {
  if (typeof value !== "string" || looksLikeMongoId(value)) return null;
  return value;
}
