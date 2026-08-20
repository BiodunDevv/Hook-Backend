export type RunnerProductSeed = {
  title: string;
  categorySlug: 'sneakers' | 'streetwear' | 'accessories' | 'dresses' | 'bags';
  description: string;
  imageUrl: string;
  costPrice: number;
  sellingPrice: number;
  floorPrice: number;
  quantity: number;
  sizes: string[];
  colors: string[];
};

const SUPPORTING_IMAGES: Record<string, [string, string]> = {
  'Aero Black Runner': ['photo-1608231387042-66d1773070a5', 'photo-1556906781-9a412961c28c'],
  'Crimson Knit Trainer': ['photo-1600185365483-26d7a4cc7519', 'photo-1552346154-21d32810aba3'],
  'Tan Street Court': ['photo-1525966222134-fcfa99b8ae77', 'photo-1595950653106-6c9ebd614d3a'],
  'Midnight Utility Jacket': ['photo-1506629082955-511b1aa562c8', 'photo-1539109136881-3be0616acf4b'],
  'Denim Layer Jacket': ['photo-1517841905240-472988babdf9', 'photo-1483985988355-763728e1935b'],
  'Ruby Graphic Tee': ['photo-1521572163474-6864f9cf17ab', 'photo-1503342217505-b0a15ec3261c'],
  'Minimal Smart Watch': ['photo-1434493789847-2f02dc6ca35d', 'photo-1524805444758-089113d48a6d'],
  'Classic Round Sunglasses': ['photo-1572635196237-14b3f281503f', 'photo-1508296695146-257a814070b4'],
  'Washed Black Cap': ['photo-1588850561407-ed78c282e89b', 'photo-1534215754734-18e55d13e346'],
  'Scarlet Flow Maxi Dress': ['photo-1572804013309-59a88b7e92f1', 'photo-1596783074918-c84cb06531ca'],
  'Plum Evening Dress': ['photo-1496747611176-843222e1e57c', 'photo-1564584217132-2271feaeb3c5'],
  'Ivory Summer Dress': ['photo-1539008835657-9e8e9680c956', 'photo-1568251188392-ae32f898cb3b'],
  'Blush Chain Shoulder Bag': ['photo-1548036328-c9fa89d128fa', 'photo-1594223274512-ad4803739b7c'],
  'Metro Everyday Backpack': ['photo-1622560480605-d83c853bc5c3', 'photo-1581605405669-fcdf81165afa'],
  'Ruby Structured Handbag': ['photo-1590874103328-eac38a683ce7', 'photo-1566150905458-1bf1fc113f0d'],
};

export function productGallery(product: RunnerProductSeed) {
  return [product.imageUrl, ...(SUPPORTING_IMAGES[product.title] || [])]
    .map((url) => {
      const source = url.startsWith('http') ? url.split('?')[0] : `https://images.unsplash.com/${url}`;
      return `${source}?w=1200&auto=format&fit=crop&q=85`;
    });
}

export function productOptions(product: RunnerProductSeed) {
  return product.sizes.flatMap((size) => product.colors.map((colour) => ({
    size,
    colour,
    attributes: {},
    active: true,
  })));
}

export const RUNNER_PRODUCT_CATALOG: RunnerProductSeed[] = [
  { title: 'Aero Black Runner', categorySlug: 'sneakers', description: 'A lightweight black running sneaker with breathable panels and a cushioned everyday sole.', imageUrl: 'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=900&auto=format&fit=crop&q=80', costPrice: 39000, sellingPrice: 52000, floorPrice: 45000, quantity: 24, sizes: ['39', '40', '41', '42', '43', '44', '45'], colors: ['#111111', '#F4F4F4', '#334155'] },
  { title: 'Crimson Knit Trainer', categorySlug: 'sneakers', description: 'A bold red knit trainer designed for comfortable daily wear and casual styling.', imageUrl: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=900&auto=format&fit=crop&q=80', costPrice: 42000, sellingPrice: 58000, floorPrice: 50000, quantity: 18, sizes: ['39', '40', '41', '42', '43', '44', '45'], colors: ['#D51D24', '#111111', '#F5F5F5'] },
  { title: 'Tan Street Court', categorySlug: 'sneakers', description: 'A clean tan low-top court sneaker with a versatile finish for workdays and weekends.', imageUrl: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=900&auto=format&fit=crop&q=80', costPrice: 35000, sellingPrice: 47000, floorPrice: 41000, quantity: 20, sizes: ['39', '40', '41', '42', '43', '44', '45'], colors: ['#B77A45', '#E7D3B0', '#2B2118'] },
  { title: 'Midnight Utility Jacket', categorySlug: 'streetwear', description: 'A black utility jacket with a relaxed streetwear silhouette and practical layering weight.', imageUrl: 'https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=900&auto=format&fit=crop&q=80', costPrice: 26000, sellingPrice: 42000, floorPrice: 35000, quantity: 16, sizes: ['S', 'M', 'L', 'XL', 'XXL'], colors: ['#111111', '#4B5563', '#556B2F'] },
  { title: 'Denim Layer Jacket', categorySlug: 'streetwear', description: 'A structured denim-inspired jacket made for easy layering across casual outfits.', imageUrl: 'https://images.unsplash.com/photo-1551488831-00ddcb6c6bd3?w=900&auto=format&fit=crop&q=80', costPrice: 28000, sellingPrice: 45000, floorPrice: 38000, quantity: 14, sizes: ['S', 'M', 'L', 'XL', 'XXL'], colors: ['#486887', '#1E3A5F', '#A9B8C8'] },
  { title: 'Ruby Graphic Tee', categorySlug: 'streetwear', description: 'A vivid graphic T-shirt with a relaxed fit for expressive everyday street style.', imageUrl: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=900&auto=format&fit=crop&q=80', costPrice: 9000, sellingPrice: 16500, floorPrice: 13500, quantity: 30, sizes: ['S', 'M', 'L', 'XL', 'XXL'], colors: ['#B51E32', '#111111', '#F4F4F4'] },
  { title: 'Minimal Smart Watch', categorySlug: 'accessories', description: 'A clean modern smartwatch with a bright face and a comfortable everyday strap.', imageUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=900&auto=format&fit=crop&q=80', costPrice: 32000, sellingPrice: 48000, floorPrice: 42000, quantity: 12, sizes: ['40 mm', '44 mm'], colors: ['#F4F4F4', '#111111', '#D7B56D'] },
  { title: 'Classic Round Sunglasses', categorySlug: 'accessories', description: 'Round-frame sunglasses with a timeless profile and lightweight everyday fit.', imageUrl: 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=900&auto=format&fit=crop&q=80', costPrice: 8500, sellingPrice: 14500, floorPrice: 12000, quantity: 28, sizes: ['50 mm', '52 mm', '54 mm'], colors: ['#1B1B1B', '#7A4B2A', '#D4AF37'] },
  { title: 'Washed Black Cap', categorySlug: 'accessories', description: 'A soft washed black cap with an adjustable back and an easy casual finish.', imageUrl: 'https://images.unsplash.com/photo-1521369909029-2afed882baee?w=900&auto=format&fit=crop&q=80', costPrice: 7000, sellingPrice: 12000, floorPrice: 9500, quantity: 32, sizes: ['54 cm', '56 cm', '58 cm'], colors: ['#171717', '#6B7280', '#C7B299'] },
  { title: 'Scarlet Flow Maxi Dress', categorySlug: 'dresses', description: 'A flowing scarlet maxi dress with an elegant shape for events and evening occasions.', imageUrl: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=900&auto=format&fit=crop&q=80', costPrice: 24000, sellingPrice: 38000, floorPrice: 32000, quantity: 16, sizes: ['6', '8', '10', '12', '14', '16'], colors: ['#D71920', '#111111', '#7F1D1D'] },
  { title: 'Plum Evening Dress', categorySlug: 'dresses', description: 'An off-shoulder plum dress with a refined silhouette for formal evenings.', imageUrl: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?w=900&auto=format&fit=crop&q=80', costPrice: 30000, sellingPrice: 48000, floorPrice: 41000, quantity: 12, sizes: ['6', '8', '10', '12', '14', '16'], colors: ['#5D245C', '#111111', '#1E3A5F'] },
  { title: 'Ivory Summer Dress', categorySlug: 'dresses', description: 'A light ivory summer dress with a relaxed shape for warm days and holidays.', imageUrl: 'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=900&auto=format&fit=crop&q=80', costPrice: 18000, sellingPrice: 29500, floorPrice: 25000, quantity: 20, sizes: ['6', '8', '10', '12', '14', '16'], colors: ['#F5F1E8', '#F4C2C2', '#A8C3A0'] },
  { title: 'Blush Chain Shoulder Bag', categorySlug: 'bags', description: 'A compact blush handbag with a polished chain strap for day-to-evening styling.', imageUrl: 'https://images.unsplash.com/photo-1566150905458-1bf1fc113f0d?w=900&auto=format&fit=crop&q=80', costPrice: 22000, sellingPrice: 35000, floorPrice: 29000, quantity: 18, sizes: ['Mini', 'Medium'], colors: ['#E9A7B1', '#111111', '#F1E3C6'] },
  { title: 'Metro Everyday Backpack', categorySlug: 'bags', description: 'A durable dark backpack with practical storage for commuting, school, and travel.', imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=900&auto=format&fit=crop&q=80', costPrice: 18000, sellingPrice: 29500, floorPrice: 24000, quantity: 24, sizes: ['16 L', '22 L', '28 L'], colors: ['#22252B', '#34495E', '#556B2F'] },
  { title: 'Ruby Structured Handbag', categorySlug: 'bags', description: 'A structured red handbag with a refined shape and versatile carry handles.', imageUrl: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=900&auto=format&fit=crop&q=80', costPrice: 28000, sellingPrice: 45000, floorPrice: 38000, quantity: 14, sizes: ['Mini', 'Medium', 'Large'], colors: ['#A8242C', '#111111', '#C49A6C'] },
];
