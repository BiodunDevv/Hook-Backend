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
  return {
    ...cart,
    items: Array.isArray(cart.items)
      ? cart.items.map((item: Record<string, any>) => ({
          ...item,
          product: publicProduct(item.product),
          productId: item.product?.hookId || item.productId,
        }))
      : cart.items,
  };
}
