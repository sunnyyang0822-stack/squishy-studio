document.querySelectorAll('.sample-art img').forEach(image => {
  const showFallback = () => {
    image.hidden = true;
    image.nextElementSibling.hidden = false;
  };
  image.addEventListener('error', showFallback, { once: true });
  if (image.complete && image.naturalWidth === 0) showFallback();
});
