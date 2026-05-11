export interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  originalPrice: number;
  rating: number;
  reviews: number;
  image: string;
  badge?: string;
  description: string;
}

export const categories = [
  "All",
  "Tech & Gadgets",
  "Home & Living",
  "Accessories",
  "Wellness",
  "Style",
];

export const products: Product[] = [
  {
    id: 1,
    name: "ProSound Elite Wireless Earbuds",
    category: "Tech & Gadgets",
    price: 49.99,
    originalPrice: 89.99,
    rating: 4.8,
    reviews: 2341,
    image: "https://images.pexels.com/photos/37420781/pexels-photo-37420781.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
    badge: "Best Seller",
    description: "Crystal-clear audio with active noise cancellation. 36-hour battery life.",
  },
  {
    id: 2,
    name: "LuxeTime Pro Smartwatch",
    category: "Tech & Gadgets",
    price: 79.99,
    originalPrice: 149.99,
    rating: 4.7,
    reviews: 1856,
    image: "https://images.pexels.com/photos/12564670/pexels-photo-12564670.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
    badge: "Trending",
    description: "Health monitoring, GPS, and premium design in one sleek package.",
  },
  {
    id: 3,
    name: "AuraGlow LED Desk Lamp",
    category: "Home & Living",
    price: 34.99,
    originalPrice: 59.99,
    rating: 4.9,
    reviews: 3102,
    image: "https://images.pexels.com/photos/6167446/pexels-photo-6167446.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
    badge: "Editor's Pick",
    description: "Smart ambient lighting with 16M colors. App-controlled mood setter.",
  },
  {
    id: 4,
    name: "VortexFit Resistance Band Set",
    category: "Wellness",
    price: 29.99,
    originalPrice: 54.99,
    rating: 4.6,
    reviews: 1245,
    image: "https://images.pexels.com/photos/31541678/pexels-photo-31541678.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
    badge: "Hot Deal",
    description: "Professional-grade bands for home workouts. 5 resistance levels included.",
  },
  {
    id: 5,
    name: "Luxe Minimalist Leather Wallet",
    category: "Accessories",
    price: 24.99,
    originalPrice: 44.99,
    rating: 4.8,
    reviews: 987,
    image: "https://images.pexels.com/photos/35336360/pexels-photo-35336360.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
    description: "RFID-blocking genuine leather. Slim profile, maximum organization.",
  },
  {
    id: 6,
    name: "CloudRest Memory Foam Pillow",
    category: "Home & Living",
    price: 39.99,
    originalPrice: 69.99,
    rating: 4.9,
    reviews: 2876,
    image: "https://images.pexels.com/photos/34171708/pexels-photo-34171708.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
    badge: "Top Rated",
    description: "Ergonomic cooling gel memory foam. Wake up refreshed every morning.",
  },
  {
    id: 7,
    name: "TechPro Laptop Stand",
    category: "Tech & Gadgets",
    price: 32.99,
    originalPrice: 59.99,
    rating: 4.7,
    reviews: 1534,
    image: "https://images.pexels.com/photos/12880803/pexels-photo-12880803.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
    description: "Adjustable aluminum stand. Improves posture and laptop airflow.",
  },
  {
    id: 8,
    name: "Signature Fragrance Collection",
    category: "Style",
    price: 44.99,
    originalPrice: 79.99,
    rating: 4.8,
    reviews: 765,
    image: "https://images.pexels.com/photos/36779952/pexels-photo-36779952.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
    badge: "New Arrival",
    description: "Premium unisex fragrance. Long-lasting scent that turns heads.",
  },
];

export const testimonials = [
  {
    id: 1,
    name: "Sarah M.",
    location: "Austin, TX",
    avatar: "SM",
    rating: 5,
    text: "I was skeptical about ordering online, but Luxedge completely changed my mind. The smartwatch I got is identical to what I'd find at a premium store — at half the price. Shipping was fast too!",
    product: "LuxeTime Pro Smartwatch",
  },
  {
    id: 2,
    name: "James R.",
    location: "Dallas, TX",
    avatar: "JR",
    rating: 5,
    text: "The quality of every product I've ordered from Luxedge has been outstanding. Their curation is on point — no junk, just genuinely great finds. My go-to store now.",
    product: "Multiple Products",
  },
  {
    id: 3,
    name: "Emily K.",
    location: "Houston, TX",
    avatar: "EK",
    rating: 5,
    text: "Finally, an online store that doesn't feel like a gamble. Every item arrives exactly as described. The LED desk lamp is absolutely stunning. Already ordered two more as gifts!",
    product: "AuraGlow LED Desk Lamp",
  },
  {
    id: 4,
    name: "Michael T.",
    location: "San Antonio, TX",
    avatar: "MT",
    rating: 5,
    text: "Customer service was incredible when I had a question about sizing. They responded within an hour and even threw in a discount code. That's how you earn loyal customers.",
    product: "Luxe Minimalist Wallet",
  },
];
