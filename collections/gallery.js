for (const image of document.querySelectorAll('.style-art img')) {
  const fail = () => { image.hidden = true; image.nextElementSibling.hidden = false; };
  image.addEventListener('error', fail, { once: true });
  if (image.complete && !image.naturalWidth) fail();
}
