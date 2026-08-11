import Link from "next/link";
import { ArrowRight, CarFront, Check, PawPrint, ShieldCheck, Sparkles, Waves } from "lucide-react";
import { CategoryCard } from "@/components/site/category-card";

const standards = ["Useful in real routines", "Clear materials and care guidance", "Delivery promises we can defend", "No inflated claims or fake urgency"];

export default function HomePage() {
  return <>
    <section className="hero">
      <div className="hero-copy"><p className="eyebrow"><span /> Curated for pets. Chosen for people.</p><h1>Better days with your <em>best friend.</em></h1><p className="hero-lede">Everyday pet essentials selected for usefulness, comfort and a calmer life together.</p><div className="hero-actions"><Link className="button button-gold" href="/shop">Explore the collection <ArrowRight size={16} /></Link><Link className="text-link" href="#standard">See how we choose</Link></div></div>
      <div className="hero-art" aria-label="Abstract illustration of a pet-friendly home"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><div className="art-card art-card-main"><PawPrint size={64} strokeWidth={1.15} /><strong>Made for the moments<br />between the milestones.</strong></div><div className="art-card art-card-note"><Sparkles size={18} /><span>Thoughtfully selected</span></div><p className="art-mark">L / E</p></div>
    </section>
    <section className="promise-strip" aria-label="LuxEdge promises"><span><ShieldCheck size={17} /> Quality reviewed</span><span><Waves size={17} /> Everyday practical</span><span><CarFront size={17} /> Delivery verified before launch</span></section>
    <section className="section collection-section"><div className="section-heading split-heading"><div><p className="eyebrow"><span /> The collection</p><h2>Built around real life.</h2></div><p>Fewer, better choices for travel, cleanup, enrichment and the daily routines you share.</p></div><div className="category-grid"><CategoryCard number="01" title="On the go" copy="Travel essentials designed for calmer, cleaner trips." icon={CarFront} /><CategoryCard number="02" title="Clean & cared for" copy="Simple tools that make everyday care feel lighter." icon={Sparkles} /><CategoryCard number="03" title="Play with purpose" copy="Enrichment for curious minds and happy routines." icon={PawPrint} /></div></section>
    <section className="standard section" id="standard"><div className="standard-panel"><p className="eyebrow light"><span /> The LuxEdge standard</p><h2>We do the checking.<br />You enjoy the good part.</h2><p>Before anything earns a place in our collection, we verify the supplier, the landed cost, the delivery promise and the product claims.</p><Link className="button button-cream" href="/shop">View launch status <ArrowRight size={16} /></Link></div><div className="standard-list">{standards.map((item, index) => <div key={item}><span>0{index + 1}</span><p>{item}</p><Check size={18} /></div>)}</div></section>
    <section className="section journal" id="journal"><p className="eyebrow"><span /> From the journal</p><div className="journal-grid"><article><p>Travel</p><h3>A calmer car ride starts before you leave.</h3><span>Guide coming soon</span></article><article><p>Care</p><h3>The five-minute reset for pet hair at home.</h3><span>Guide coming soon</span></article></div></section>
  </>;
}
