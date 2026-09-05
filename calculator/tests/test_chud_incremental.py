import sys
from math import isqrt

if hasattr(sys, "set_int_max_str_digits"):
    sys.set_int_max_str_digits(0)

C = 426880
K1 = 545140134
K2 = 13591409
K3 = 640320
K3_CUBE = K3 ** 3
DIGITS_PER_TERM = 14.1816474627
SAFETY_MARGIN = 5
EXTRA = 10


class Engine:
    def __init__(self, n=0, P=0, M=1, L=K2, digits_done=0):
        self.n = n
        self.P = P
        self.M = M
        self.L = L
        self.digits_done = digits_done

    def estimate_digits(self):
        est = int(self.n * DIGITS_PER_TERM) - SAFETY_MARGIN
        return max(est, 0)

    def add_terms(self, m):
        if m <= 0:
            return
        D_m = K3_CUBE ** m
        sign = 1 if self.n % 2 == 0 else -1
        D_current = D_m
        S_part = 0
        M = self.M
        L = self.L
        for j in range(m):
            if j > 0:
                k = self.n + j
                M = M * 24 * (6 * k - 5) * (2 * k - 1) * (6 * k - 1) // (k ** 3)
                L += K1
                D_current //= K3_CUBE
            S_part += sign * M * L * D_current
            sign = -sign
        self.P = self.P * D_m + S_part
        self.M = M
        self.L = L
        self.n += m


def evaluate(engine, digits):
    scale = 10 ** (digits + EXTRA)
    sqrt_10005 = isqrt(10005 * scale * scale)
    numerator = C * sqrt_10005
    denom = engine.P if engine.n % 2 == 0 else -engine.P
    pi_scaled = (numerator * scale * (K3_CUBE ** engine.n)) // denom
    pi_str = str(pi_scaled)[:-EXTRA]
    return f"{pi_str[0]}.{pi_str[1:]}"


# Test : ajouter les termes par blocs de 100, 200, 300
e = Engine()
for block in [100, 200, 300]:
    e.add_terms(block)
    reached = e.estimate_digits()
    print(f"n={e.n}, digits_est={reached}, pi={evaluate(e, max(100, reached))[:52]}")
