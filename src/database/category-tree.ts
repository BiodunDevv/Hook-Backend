import type { CategoryAttribute, SizePreset } from '@models/categories/category.model';
import { BRA_GUIDE, CLOTHING_GUIDE, KIDS_SHOE_GUIDE, SHOE_GUIDE, type SeedSizingGuide } from './sizing-guides';

/**
 * The Hook category tree and what a product in each category asks for.
 * Shared by the seed script and the tests, so the rules live in one place.
 * A sub-category with no `attributes` inherits its parent's.
 */
export interface CategoryNode {
  name: string;
  description?: string;
  attributes?: CategoryAttribute[];
  sizingPresets?: SizePreset[];
  /** Shown wherever a product in this category (or a sub-category) has a size. */
  sizingGuide?: SeedSizingGuide;
  children?: CategoryNode[];
}

const colour = (label = 'Colour', required = true): CategoryAttribute => ({ key: 'colour', label, type: 'colour', required, variantAxis: true });
const size = (label: string, preset: SizePreset, required = true): CategoryAttribute => ({ key: 'size', label, type: 'size', required, preset, variantAxis: true });
const select = (key: string, label: string, options: string[], required = true, variantAxis = true): CategoryAttribute => ({ key, label, type: 'select', required, options, variantAxis });
const text = (key: string, label: string, required = true, variantAxis = true): CategoryAttribute => ({ key, label, type: 'text', required, variantAxis });

const shoeSize = () => size('Shoe size', 'shoes');
const clothingSize = () => size('Size', 'clothing');
const gender = () => select('gender', 'Gender', ['Male', 'Female'], true, true);

export const CATEGORY_TREE: CategoryNode[] = [
  { name: 'Wigs', description: 'Wigs and hair pieces', attributes: [
    select('length', 'Length', ['8"', '10"', '12"', '14"', '16"', '18"', '20"', '22"', '24"', '26"', '28"', '30"']),
    select('texture', 'Texture', ['Straight', 'Body wave', 'Deep wave', 'Curly', 'Kinky']),
    colour(),
  ] },
  { name: 'Shoes', description: 'Sneakers, corporate shoes, slides and sandals', attributes: [shoeSize(), colour()], sizingPresets: ['shoes'], sizingGuide: SHOE_GUIDE, children: [
    { name: 'Sneakers male' }, { name: 'Sneakers female' },
    { name: 'Corporate shoes male' }, { name: 'Corporate shoes female' },
    { name: 'Slides male' }, { name: 'Slides female' },
    { name: 'Sandals male' }, { name: 'Sandals female' },
  ] },
  { name: 'Bags', description: 'Bags for men and women', attributes: [colour(), select('size', 'Size', ['Small', 'Medium', 'Large'], false)], children: [
    { name: 'Male bags' }, { name: 'Female bags' },
  ] },
  { name: 'Watch', description: 'Watches', attributes: [colour('Colour')], children: [
    { name: 'Leather watches' }, { name: 'Chain watches' }, { name: 'Rubber strap watches' },
  ] },
  { name: 'Glasses', description: 'Frames and sunglasses. No sizes.', attributes: [colour('Frame colour')], children: [
    { name: 'Female glasses' }, { name: 'Male glasses' }, { name: 'Clear glasses' }, { name: 'Sun shades' },
  ] },
  { name: 'Children', description: 'Children shoes and bags', children: [
    { name: 'Children shoes', attributes: [gender(), size('Kids shoe size', 'kids-shoes'), colour()], sizingPresets: ['kids-shoes'], sizingGuide: KIDS_SHOE_GUIDE },
    { name: 'Children sneakers', attributes: [gender(), size('Kids shoe size', 'kids-shoes'), colour()], sizingPresets: ['kids-shoes'], sizingGuide: KIDS_SHOE_GUIDE },
    { name: 'Children slides', attributes: [gender(), size('Kids shoe size', 'kids-shoes'), colour()], sizingPresets: ['kids-shoes'], sizingGuide: KIDS_SHOE_GUIDE },
    { name: 'Children sandals', attributes: [gender(), size('Kids shoe size', 'kids-shoes'), colour()], sizingPresets: ['kids-shoes'], sizingGuide: KIDS_SHOE_GUIDE },
    { name: 'Children bags', attributes: [colour()] },
  ] },
  { name: 'Sports & Fitness', description: 'Boots, jerseys, mats and sportswear', children: [
    { name: 'Football boots', attributes: [shoeSize(), colour()], sizingPresets: ['shoes'], sizingGuide: SHOE_GUIDE },
    { name: 'Jerseys', attributes: [clothingSize(), colour()], sizingPresets: ['clothing'], sizingGuide: CLOTHING_GUIDE },
    { name: 'Yoga mats', attributes: [select('thickness', 'Thickness', ['4 mm', '6 mm', '8 mm'], false), colour()] },
    { name: 'Sportswear', attributes: [clothingSize(), colour()], sizingPresets: ['clothing'], sizingGuide: CLOTHING_GUIDE },
    { name: 'Fitness accessories', attributes: [text('type', 'Type', false), colour('Colour', false)] },
  ] },
  { name: 'Underwear', description: 'Boxers, bras, singlets and socks', children: [
    { name: 'Boxers', attributes: [clothingSize(), colour()], sizingPresets: ['clothing'], sizingGuide: CLOTHING_GUIDE },
    { name: 'Bra', attributes: [size('Bra size', 'bra'), colour()], sizingPresets: ['bra'], sizingGuide: BRA_GUIDE },
    { name: 'Singlet', attributes: [clothingSize(), colour()], sizingPresets: ['clothing'], sizingGuide: CLOTHING_GUIDE },
    { name: 'Socks', attributes: [select('sizeRange', 'Size range', ['36 - 40', '41 - 45']), select('pack', 'Pack size', ['1 pair', '3 pairs', '6 pairs', '12 pairs'], false), colour()] },
  ] },
  { name: 'Clothing', description: 'Dresses and jackets', attributes: [clothingSize(), colour()], sizingPresets: ['clothing'], sizingGuide: CLOTHING_GUIDE, children: [
    { name: 'Dresses' }, { name: 'Jackets' },
  ] },
  { name: 'Fabrics', description: 'Fabrics sold by the yard', attributes: [select('yards', 'Length', ['2 yards', '5 yards', '6 yards', '12 yards']), colour('Colour or pattern')], children: [
    { name: 'Adire' }, { name: 'Lace' }, { name: 'Other types of fabric' },
  ] },
  { name: 'Gadgets', description: 'Chargers, audio and phone accessories. No sizes.', children: [
    { name: 'Powerbank', attributes: [select('capacity', 'Capacity', ['5,000 mAh', '10,000 mAh', '20,000 mAh', '30,000 mAh'], true), colour()] },
    { name: 'Chargers', attributes: [select('wattage', 'Wattage', ['18 W', '20 W', '33 W', '45 W', '65 W']), select('connector', 'Connector', ['USB-C', 'Lightning', 'Micro-USB']), colour('Colour', false)] },
    { name: 'Headphone', attributes: [select('connectivity', 'Connectivity', ['Wired', 'Bluetooth']), colour()] },
    { name: 'Earpods', attributes: [select('compatibility', 'Compatible with', ['iPhone', 'Android', 'Universal']), colour()] },
    { name: 'Speakers', attributes: [select('connectivity', 'Connectivity', ['Bluetooth', 'Wired'], false), colour()] },
    { name: 'Phone cases', attributes: [text('phoneModel', 'Phone model'), colour()] },
    { name: 'Cables', attributes: [select('connector', 'Connector', ['USB-C', 'Lightning', 'Micro-USB']), select('length', 'Length', ['1 m', '2 m', '3 m']), colour('Colour', false)] },
  ] },
];

export const SIZE_PRESETS: Record<SizePreset, string[]> = {
  clothing: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
  shoes: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'],
  'kids-shoes': ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35'],
  bra: ['32A', '32B', '32C', '34A', '34B', '34C', '34D', '36B', '36C', '36D', '38C', '38D', '40C', '40D'],
  general: ['One size', 'Small', 'Medium', 'Large'],
};
