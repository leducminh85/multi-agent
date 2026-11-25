import { describe, expect, it } from 'vitest';
import { translateText } from './i18n';

describe('Vietnamese interface translation', () => {
  it('translates exact interface strings and keeps surrounding whitespace', () => {
    expect(translateText('Virtual office')).toBe('Văn phòng ảo');
    expect(translateText('  Launch mission ')).toBe('  Giao việc ');
    expect(translateText('Approve')).toBe('Duyệt');
  });

  it('translates dynamic messages through patterns', () => {
    expect(translateText('2 working · 4 idle · click a person for details')).toBe('2 đang làm · 4 rảnh · bấm vào một người để xem chi tiết');
    expect(translateText('Requests (3)')).toBe('Yêu cầu (3)');
    expect(translateText('Rin (Research) completed "Find sources"')).toBe('Rin (Research) đã hoàn thành "Find sources"');
    expect(translateText('Mission "Slogans" finished with 1 failed task(s)')).toBe('Yêu cầu "Slogans" kết thúc với 1 task lỗi');
    expect(translateText('12s ago')).toBe('12 giây trước');
    expect(translateText('active 3m ago')).toBe('hoạt động 3 phút trước');
  });

  it('leaves unknown text (user / AI content), numbers and empty strings alone', () => {
    expect(translateText('Write three slogans for my coffee shop')).toBeNull();
    expect(translateText('42')).toBeNull();
    expect(translateText('   ')).toBeNull();
  });
});
