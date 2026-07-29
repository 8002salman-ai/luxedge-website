import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  CreditCard,
  Truck,
  Shield,
  CheckCircle,
  Loader2,
  ChevronLeft,
  Lock,
  AlertCircle,
} from 'lucide-react';
import { useCartStore } from '../../store/cartStore';
import { useAuthStore } from '../../store/authStore';
import { useOrderStore } from '../../store/orderStore';
import { useProductStore } from '../../store/productStore';
import { useNotificationStore } from '../../store/notificationStore';

type PaymentMethod = 'card' | 'paypal';
type CheckoutStep = 'shipping' | 'payment' | 'review' | 'processing' | 'success' | 'failed';

// Simulated Stripe Card Element styles
const cardInputStyles = "w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all";

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { items, getSubtotal, getShipping, getCartTotal, clearCart } = useCartStore();
  const { user } = useAuthStore();
  const createOrder = useOrderStore((state) => state.createOrder);
  const updateStock = useProductStore((state) => state.updateStock);
  const addNotification = useNotificationStore((state) => state.addNotification);

  const [step, setStep] = useState<CheckoutStep>('shipping');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [orderId, setOrderId] = useState('');
  const [paymentError, setPaymentError] = useState('');

  // Shipping Form
  const [shippingData, setShippingData] = useState({
    firstName: user?.name.split(' ')[0] || '',
    lastName: user?.name.split(' ')[1] || '',
    email: user?.email || '',
    phone: user?.phone || '',
    address: '',
    apartment: '',
    city: '',
    state: '',
    zip: '',
    country: 'US',
  });

  // Card Form (Stripe simulation)
  const [cardData, setCardData] = useState({
    number: '',
    expiry: '',
    cvc: '',
    name: '',
  });

  const subtotal = getSubtotal();
  const shipping = getShipping();
  const total = getCartTotal();

  // US States for dropdown
  const usStates = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
  ];

  const validateShipping = () => {
    if (!shippingData.firstName || !shippingData.lastName || !shippingData.email ||
        !shippingData.phone || !shippingData.address || !shippingData.city ||
        !shippingData.state || !shippingData.zip) {
      addNotification({ type: 'error', message: 'Please fill in all required fields' });
      return false;
    }
    // Basic US ZIP validation
    if (!/^\d{5}(-\d{4})?$/.test(shippingData.zip)) {
      addNotification({ type: 'error', message: 'Please enter a valid US ZIP code' });
      return false;
    }
    return true;
  };

  const validateCard = () => {
    // Basic card validation
    const cardNumber = cardData.number.replace(/\s/g, '');
    if (!/^\d{16}$/.test(cardNumber)) {
      setPaymentError('Please enter a valid card number');
      return false;
    }
    if (!/^\d{2}\/\d{2}$/.test(cardData.expiry)) {
      setPaymentError('Please enter a valid expiry date (MM/YY)');
      return false;
    }
    if (!/^\d{3,4}$/.test(cardData.cvc)) {
      setPaymentError('Please enter a valid CVC');
      return false;
    }
    if (!cardData.name) {
      setPaymentError('Please enter the cardholder name');
      return false;
    }
    setPaymentError('');
    return true;
  };

  const handleShippingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateShipping()) {
      setStep('payment');
    }
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (paymentMethod === 'card' && !validateCard()) {
      return;
    }

    setStep('processing');

    // Simulate payment processing
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Simulate success/failure (95% success rate for demo)
    const isSuccess = Math.random() > 0.05;

    if (isSuccess) {
      // Create order
      const order = createOrder(
        user!.id,
        `${shippingData.firstName} ${shippingData.lastName}`,
        shippingData.email,
        items,
        {
          name: `${shippingData.firstName} ${shippingData.lastName}`,
          address: shippingData.apartment 
            ? `${shippingData.address}, ${shippingData.apartment}`
            : shippingData.address,
          city: shippingData.city,
          state: shippingData.state,
          zip: shippingData.zip,
          phone: shippingData.phone,
        },
        paymentMethod === 'card' ? 'Stripe (Credit Card)' : 'PayPal'
      );

      // Update stock
      items.forEach((item) => {
        updateStock(item.productId, -item.quantity);
      });

      // Clear cart
      clearCart();

      setOrderId(order.id);
      setStep('success');
      addNotification({ type: 'success', message: 'Payment successful! Order placed.' });
    } else {
      setStep('failed');
      setPaymentError('Payment was declined. Please try again or use a different payment method.');
    }
  };

  const handlePayPalCheckout = async () => {
    setStep('processing');

    // Simulate PayPal redirect and processing
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Create order
    const order = createOrder(
      user!.id,
      `${shippingData.firstName} ${shippingData.lastName}`,
      shippingData.email,
      items,
      {
        name: `${shippingData.firstName} ${shippingData.lastName}`,
        address: shippingData.apartment 
          ? `${shippingData.address}, ${shippingData.apartment}`
          : shippingData.address,
        city: shippingData.city,
        state: shippingData.state,
        zip: shippingData.zip,
        phone: shippingData.phone,
      },
      'PayPal'
    );

    items.forEach((item) => {
      updateStock(item.productId, -item.quantity);
    });

    clearCart();
    setOrderId(order.id);
    setStep('success');
    addNotification({ type: 'success', message: 'PayPal payment successful!' });
  };

  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    const matches = v.match(/\d{4,16}/g);
    const match = (matches && matches[0]) || '';
    const parts = [];
    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }
    return parts.length ? parts.join(' ') : value;
  };

  const formatExpiry = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    if (v.length >= 2) {
      return v.substring(0, 2) + '/' + v.substring(2, 4);
    }
    return v;
  };

  if (items.length === 0 && step !== 'success') {
    navigate('/cart');
    return null;
  }

  // Success State
  if (step === 'success') {
    return (
      <div className="min-h-[70vh] flex items-center justify-center py-12 px-4">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-scale-in">
            <CheckCircle size={40} className="text-green-500" />
          </div>
          <h1 className="text-2xl font-bold text-luxe-dark mb-2">Order Confirmed!</h1>
          <p className="text-luxe-gray mb-2">
            Thank you for your purchase. Your order <span className="font-semibold text-luxe-gold">#{orderId}</span> has been placed successfully.
          </p>
          <p className="text-sm text-luxe-gray mb-6">
            A confirmation email has been sent to <span className="font-medium">{shippingData.email}</span>
          </p>

          <div className="bg-luxe-cream/50 rounded-xl p-4 mb-6 text-left">
            <h3 className="font-semibold text-sm text-luxe-dark mb-2">Shipping to:</h3>
            <p className="text-sm text-luxe-gray">
              {shippingData.firstName} {shippingData.lastName}<br />
              {shippingData.address}{shippingData.apartment && `, ${shippingData.apartment}`}<br />
              {shippingData.city}, {shippingData.state} {shippingData.zip}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/orders"
              className="px-6 py-3 bg-luxe-gold text-white font-semibold rounded-lg hover:bg-luxe-gold-dark transition-colors"
            >
              View Order
            </Link>
            <Link
              to="/shop"
              className="px-6 py-3 border border-gray-200 text-luxe-dark font-semibold rounded-lg hover:bg-gray-50 transition-colors"
            >
              Continue Shopping
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Processing State
  if (step === 'processing') {
    return (
      <div className="min-h-[70vh] flex items-center justify-center py-12 px-4">
        <div className="text-center">
          <div className="w-20 h-20 bg-luxe-gold/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Loader2 size={36} className="text-luxe-gold animate-spin" />
          </div>
          <h2 className="text-xl font-bold text-luxe-dark mb-2">Processing Payment...</h2>
          <p className="text-luxe-gray">Please wait while we process your payment securely.</p>
          <p className="text-xs text-luxe-gray mt-4">Do not close this window.</p>
        </div>
      </div>
    );
  }

  // Failed State
  if (step === 'failed') {
    return (
      <div className="min-h-[70vh] flex items-center justify-center py-12 px-4">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle size={40} className="text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-luxe-dark mb-2">Payment Failed</h1>
          <p className="text-luxe-gray mb-6">{paymentError}</p>
          <button
            onClick={() => setStep('payment')}
            className="px-6 py-3 bg-luxe-gold text-white font-semibold rounded-lg hover:bg-luxe-gold-dark transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-8 bg-luxe-cream/30 min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <Link to="/cart" className="flex items-center gap-2 text-sm text-luxe-gray hover:text-luxe-gold">
            <ChevronLeft size={16} />
            Back to Cart
          </Link>
          <div className="flex items-center gap-2">
            <Lock size={14} className="text-green-600" />
            <span className="text-xs text-green-600 font-medium">Secure Checkout</span>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-8">
          {['Shipping', 'Payment', 'Review'].map((s, i) => {
            const stepIndex = ['shipping', 'payment', 'review'].indexOf(step);
            const isActive = i === stepIndex;
            const isComplete = i < stepIndex;
            return (
              <div key={s} className="flex items-center">
                <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                  isComplete ? 'bg-green-500 text-white' :
                  isActive ? 'bg-luxe-gold text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  {isComplete ? '✓' : i + 1}
                </div>
                <span className={`ml-2 text-sm ${isActive ? 'font-medium text-luxe-dark' : 'text-gray-500'}`}>
                  {s}
                </span>
                {i < 2 && <div className="w-12 h-0.5 mx-3 bg-gray-200" />}
              </div>
            );
          })}
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Form */}
          <div className="lg:col-span-2">
            {/* Shipping Step */}
            {step === 'shipping' && (
              <form onSubmit={handleShippingSubmit} className="bg-white rounded-xl border border-gray-100 p-6">
                <div className="flex items-center gap-3 mb-6">
                  <Truck size={20} className="text-luxe-gold" />
                  <h2 className="font-semibold text-lg text-luxe-dark">Shipping Information</h2>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                      First Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={shippingData.firstName}
                      onChange={(e) => setShippingData({ ...shippingData, firstName: e.target.value })}
                      className={cardInputStyles}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                      Last Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={shippingData.lastName}
                      onChange={(e) => setShippingData({ ...shippingData, lastName: e.target.value })}
                      className={cardInputStyles}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                      Email *
                    </label>
                    <input
                      type="email"
                      required
                      value={shippingData.email}
                      onChange={(e) => setShippingData({ ...shippingData, email: e.target.value })}
                      className={cardInputStyles}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                      Phone *
                    </label>
                    <input
                      type="tel"
                      required
                      value={shippingData.phone}
                      onChange={(e) => setShippingData({ ...shippingData, phone: e.target.value })}
                      className={cardInputStyles}
                      placeholder="(555) 123-4567"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                      Street Address *
                    </label>
                    <input
                      type="text"
                      required
                      value={shippingData.address}
                      onChange={(e) => setShippingData({ ...shippingData, address: e.target.value })}
                      className={cardInputStyles}
                      placeholder="123 Main Street"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                      Apartment, Suite, etc. (optional)
                    </label>
                    <input
                      type="text"
                      value={shippingData.apartment}
                      onChange={(e) => setShippingData({ ...shippingData, apartment: e.target.value })}
                      className={cardInputStyles}
                      placeholder="Apt 4B"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                      City *
                    </label>
                    <input
                      type="text"
                      required
                      value={shippingData.city}
                      onChange={(e) => setShippingData({ ...shippingData, city: e.target.value })}
                      className={cardInputStyles}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                        State *
                      </label>
                      <select
                        required
                        value={shippingData.state}
                        onChange={(e) => setShippingData({ ...shippingData, state: e.target.value })}
                        className={cardInputStyles}
                      >
                        <option value="">Select</option>
                        {usStates.map((state) => (
                          <option key={state} value={state}>{state}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                        ZIP Code *
                      </label>
                      <input
                        type="text"
                        required
                        value={shippingData.zip}
                        onChange={(e) => setShippingData({ ...shippingData, zip: e.target.value })}
                        className={cardInputStyles}
                        placeholder="12345"
                        maxLength={10}
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full mt-6 py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-lg transition-all"
                >
                  Continue to Payment
                </button>
              </form>
            )}

            {/* Payment Step */}
            {step === 'payment' && (
              <div className="bg-white rounded-xl border border-gray-100 p-6">
                <div className="flex items-center gap-3 mb-6">
                  <CreditCard size={20} className="text-luxe-gold" />
                  <h2 className="font-semibold text-lg text-luxe-dark">Payment Method</h2>
                </div>

                {/* Payment Method Selection */}
                <div className="grid sm:grid-cols-2 gap-4 mb-6">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('card')}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      paymentMethod === 'card'
                        ? 'border-luxe-gold bg-luxe-gold/5'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-8 bg-gradient-to-r from-blue-600 to-blue-400 rounded flex items-center justify-center">
                        <span className="text-white text-xs font-bold">STRIPE</span>
                      </div>
                      <div className="text-left">
                        <p className="font-medium text-sm">Credit / Debit Card</p>
                        <p className="text-xs text-gray-500">Visa, Mastercard, Amex</p>
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('paypal')}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      paymentMethod === 'paypal'
                        ? 'border-luxe-gold bg-luxe-gold/5'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-8 bg-[#003087] rounded flex items-center justify-center">
                        <span className="text-white text-xs font-bold">PayPal</span>
                      </div>
                      <div className="text-left">
                        <p className="font-medium text-sm">PayPal</p>
                        <p className="text-xs text-gray-500">Fast & secure checkout</p>
                      </div>
                    </div>
                  </button>
                </div>

                {/* Card Form (Stripe simulation) */}
                {paymentMethod === 'card' && (
                  <form onSubmit={handlePaymentSubmit} className="space-y-4">
                    {paymentError && (
                      <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2 text-red-600 text-sm">
                        <AlertCircle size={16} />
                        {paymentError}
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                        Card Number
                      </label>
                      <input
                        type="text"
                        value={cardData.number}
                        onChange={(e) => setCardData({ ...cardData, number: formatCardNumber(e.target.value) })}
                        className={cardInputStyles}
                        placeholder="1234 5678 9012 3456"
                        maxLength={19}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                          Expiry Date
                        </label>
                        <input
                          type="text"
                          value={cardData.expiry}
                          onChange={(e) => setCardData({ ...cardData, expiry: formatExpiry(e.target.value) })}
                          className={cardInputStyles}
                          placeholder="MM/YY"
                          maxLength={5}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                          CVC
                        </label>
                        <input
                          type="text"
                          value={cardData.cvc}
                          onChange={(e) => setCardData({ ...cardData, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                          className={cardInputStyles}
                          placeholder="123"
                          maxLength={4}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                        Cardholder Name
                      </label>
                      <input
                        type="text"
                        value={cardData.name}
                        onChange={(e) => setCardData({ ...cardData, name: e.target.value })}
                        className={cardInputStyles}
                        placeholder="JOHN DOE"
                      />
                    </div>

                    <div className="flex gap-3 pt-4">
                      <button
                        type="button"
                        onClick={() => setStep('shipping')}
                        className="px-6 py-3 border border-gray-200 text-luxe-dark font-medium rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Back
                      </button>
                      <button
                        type="submit"
                        className="flex-1 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
                      >
                        <Lock size={16} />
                        Pay ${total.toFixed(2)}
                      </button>
                    </div>
                  </form>
                )}

                {/* PayPal Button */}
                {paymentMethod === 'paypal' && (
                  <div className="space-y-4">
                    <div className="bg-gray-50 rounded-lg p-4 text-center">
                      <p className="text-sm text-gray-600 mb-4">
                        You will be redirected to PayPal to complete your purchase securely.
                      </p>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setStep('shipping')}
                          className="px-6 py-3 border border-gray-200 text-luxe-dark font-medium rounded-lg hover:bg-gray-50 transition-colors"
                        >
                          Back
                        </button>
                        <button
                          onClick={handlePayPalCheckout}
                          className="flex-1 py-3 bg-[#0070ba] hover:bg-[#003087] text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
                        >
                          <span className="font-bold">PayPal</span>
                          <span>Checkout</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Security Note */}
                <div className="mt-6 flex items-center gap-2 text-xs text-gray-500">
                  <Shield size={14} className="text-green-500" />
                  <span>Your payment information is encrypted and secure. We never store your card details.</span>
                </div>
              </div>
            )}
          </div>

          {/* Order Summary */}
          <div>
            <div className="bg-white rounded-xl border border-gray-100 p-6 sticky top-24">
              <h2 className="font-semibold text-lg text-luxe-dark mb-6">Order Summary</h2>

              <div className="space-y-4 mb-6 max-h-60 overflow-y-auto">
                {items.map((item) => (
                  <div key={item.productId} className="flex gap-3">
                    <div className="relative">
                      <img
                        src={item.product.images[0]?.url}
                        alt={item.product.name}
                        className="w-16 h-16 object-cover rounded-lg"
                      />
                      <span className="absolute -top-2 -right-2 w-5 h-5 bg-luxe-gold text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                        {item.quantity}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-luxe-dark line-clamp-1">
                        {item.product.name}
                      </p>
                      <p className="text-xs text-luxe-gray">${item.product.price.toFixed(2)} each</p>
                    </div>
                    <p className="text-sm font-semibold text-luxe-dark">
                      ${(item.product.price * item.quantity).toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-100 pt-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-luxe-gray">Subtotal</span>
                  <span className="font-medium">${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-luxe-gray">Shipping</span>
                  <span className={`font-medium ${shipping === 0 ? 'text-green-600' : ''}`}>
                    {shipping === 0 ? 'FREE' : `$${shipping.toFixed(2)}`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-luxe-gray">Tax</span>
                  <span className="font-medium">Calculated at checkout</span>
                </div>
                <div className="border-t border-gray-100 pt-3 flex justify-between">
                  <span className="font-semibold text-luxe-dark">Total</span>
                  <div className="text-right">
                    <span className="text-xl font-bold text-luxe-dark">${total.toFixed(2)}</span>
                    <p className="text-[10px] text-luxe-gray">USD</p>
                  </div>
                </div>
              </div>

              {/* Trust Badges */}
              <div className="mt-6 pt-6 border-t border-gray-100 space-y-2">
                {['Free shipping on $50+', 'Secure SSL checkout', '30-day returns'].map((text) => (
                  <p key={text} className="flex items-center gap-2 text-xs text-luxe-gray">
                    <span className="w-1.5 h-1.5 bg-luxe-gold rounded-full" />
                    {text}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
